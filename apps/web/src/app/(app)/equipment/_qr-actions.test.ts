import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  assertCan: vi.fn(),
  scope: vi.fn(),
  audit: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireRequestContext: mocks.auth }))
vi.mock('@beaconhs/tenant', () => ({ assertCan: mocks.assertCan }))
vi.mock('@beaconhs/tenant/visibility', () => ({ moduleScopeWhere: mocks.scope }))
vi.mock('@/lib/audit', () => ({ recordAuditInTransaction: mocks.audit }))
import { generateBulkQrSheet } from './_qr-actions'

const A = '00000000-0000-4000-8000-000000000001'
const B = '00000000-0000-4000-8000-000000000002'
let ctx: { db: ReturnType<typeof vi.fn> }
let tx: { select: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
let lock: ReturnType<typeof vi.fn>
let set: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
  lock = vi.fn().mockResolvedValue([{ id: A }, { id: B }])
  const query = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), for: lock }
  set = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
  tx = { select: vi.fn().mockReturnValue(query), update: vi.fn().mockReturnValue({ set }) }
  ctx = { db: vi.fn(async (run) => run(tx)) }
  mocks.auth.mockResolvedValue(ctx)
})

describe('equipment selection QR sheet', () => {
  it('requires site read permission and rejects invalid selections before database access', async () => {
    const result = await generateBulkQrSheet({ equipmentIds: ['bad-id'] })
    expect(result.ok).toBe(false)
    expect(mocks.assertCan).toHaveBeenCalledWith(ctx, 'equipment.read.site')
    expect(ctx.db).not.toHaveBeenCalled()
    mocks.assertCan.mockImplementation(() => {
      throw new Error('Forbidden')
    })
    await expect(generateBulkQrSheet({ equipmentIds: [A] })).rejects.toThrow('Forbidden')
    expect(ctx.db).not.toHaveBeenCalled()
  })

  it('does not stamp or export a partial deleted or out-of-scope selection', async () => {
    lock.mockResolvedValue([{ id: A }])
    expect((await generateBulkQrSheet({ equipmentIds: [A, B] })).ok).toBe(false)
    expect(mocks.scope).toHaveBeenCalledWith(
      ctx,
      tx,
      expect.objectContaining({ prefix: 'equipment' }),
    )
    expect(lock).toHaveBeenCalledWith('update')
    expect(tx.update).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('stamps and audits the deduplicated selection in the same transaction', async () => {
    const result = await generateBulkQrSheet({ equipmentIds: [A, A, B] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const url = new URL(result.href, 'https://app.test')
    expect(url.pathname).toBe('/equipment/qr/labels')
    expect(url.searchParams.get('ids')).toBe(`${A},${B}`)
    expect(url.searchParams.get('token')).toMatch(/^[A-Za-z0-9_-]{11}$/)
    expect(result.count).toBe(2)
    expect(set).toHaveBeenCalledWith({
      bulkQrToken: url.searchParams.get('token'),
      bulkQrGeneratedAt: expect.any(Date),
    })
    expect(mocks.audit).toHaveBeenCalledWith(
      tx,
      ctx,
      expect.objectContaining({
        action: 'export',
        metadata: { bulkToken: url.searchParams.get('token'), itemIds: [A, B] },
      }),
    )
  })
})
