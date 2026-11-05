import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  lock: vi.fn(),
  checkIn: vi.fn(),
  search: vi.fn(),
  scan: vi.fn(),
  audit: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  requireRequestContext: mocks.auth,
  requireExportContext: mocks.auth,
}))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit, recordAuditInTransaction: mocks.audit }))
vi.mock('@/lib/equipment-custody', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/equipment-custody')>()),
  lockEquipmentCustodyRows: mocks.lock,
  checkInEquipmentInTx: mocks.checkIn,
}))
vi.mock('@/lib/equipment-station', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/equipment-station')>()),
  searchStationCore: mocks.search,
  stationScanCore: mocks.scan,
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
import { checkInEquipment } from './_actions'
import { checkOutFromItem, transferLocation } from './[id]/_custody-actions'
import { searchStation, performStationScan } from './station/_actions'

const itemId = '10000000-0000-4000-8000-000000000001'
const personId = '10000000-0000-4000-8000-000000000002'
const writes = vi.fn()
const tx = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: personId }] }) }) }),
  insert: () => ({
    values: (input: unknown) => {
      writes(input)
      return { returning: async () => [{ id: itemId }] }
    },
  }),
  update: () => ({ set: (input: unknown) => ({ where: async () => writes(input) }) }),
}
const ctx = {
  tenantId: itemId,
  membership: { id: itemId },
  personId,
  isSuperAdmin: false,
  permissions: new Set<string>(),
  db: vi.fn(async (run) => run(tx)),
}
function form() {
  const input = new FormData()
  input.set('itemId', itemId)
  input.set('id', itemId)
  input.set('holderPersonId', personId)
  return input
}
beforeEach(() => {
  vi.clearAllMocks()
  ctx.permissions = new Set(['equipment.custody'])
  mocks.auth.mockResolvedValue(ctx)
  mocks.lock.mockResolvedValue([
    { id: itemId, status: 'in_service', deletedAt: null, isMissing: false, isCheckedOut: false },
  ])
  mocks.checkIn.mockResolvedValue(null)
  mocks.search.mockResolvedValue({ equipment: [], people: [] })
  mocks.scan.mockResolvedValue({ ok: true, action: 'checked_in', itemId, assetTag: 'UNIT-1' })
})

describe('standard equipment custody permission', () => {
  it('allows check-out and check-in without equipment management', async () => {
    await checkOutFromItem(form())
    expect(writes).toHaveBeenCalled()
    expect(mocks.audit).toHaveBeenCalledWith(
      tx,
      ctx,
      expect.objectContaining({ entityType: 'equipment_checkout' }),
    )
    const input = form()
    input.delete('id')
    await checkInEquipment(input)
    expect(mocks.checkIn).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ itemId, canCheckIn: true }),
    )
  })

  it('allows station search and both scan directions without management', async () => {
    await searchStation('UNIT-1')
    await performStationScan({ code: 'UNIT-1', direction: 'in' })
    await performStationScan({ code: 'UNIT-1', direction: 'out', activePersonId: personId })
    expect(mocks.search).toHaveBeenCalledOnce()
    expect(mocks.scan).toHaveBeenCalledTimes(2)
  })

  it.each([
    { permissions: [] },
    { permissions: ['equipment.read.all'] },
    { permissions: ['equipment.manage'] },
  ])('requires the explicit custody grant for permissions %j', async ({ permissions }) => {
    ctx.permissions = new Set(permissions)
    await expect(checkOutFromItem(form())).rejects.toThrow()
    await expect(checkInEquipment(form())).rejects.toThrow()
    await expect(searchStation('UNIT-1')).rejects.toThrow()
    await expect(performStationScan({ code: 'UNIT-1' })).rejects.toThrow()
    expect(ctx.db).not.toHaveBeenCalled()
    expect(writes).not.toHaveBeenCalled()
  })

  it('does not grant direct custody transfers or equipment editing', async () => {
    await expect(transferLocation(form())).rejects.toThrow()
    expect(ctx.db).not.toHaveBeenCalled()
  })
})
