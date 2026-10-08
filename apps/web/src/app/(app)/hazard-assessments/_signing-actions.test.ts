import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { HazidSigningError } from '@/lib/hazid-signing-result'

const mocks = vi.hoisted(() => ({
  ctx: { tenantId: '10000000-0000-4000-8000-000000000001', db: vi.fn() },
  lock: vi.fn(),
  audit: vi.fn(),
  evidence: vi.fn(),
  flow: vi.fn(),
  assertCan: vi.fn(),
  store: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }))
vi.mock('@beaconhs/tenant', () => ({ assertCan: mocks.assertCan }))
vi.mock('@beaconhs/compliance', () => ({ materializeEvidenceTargetObligations: mocks.evidence }))
vi.mock('@beaconhs/events', () => ({
  recordModuleFlowEvent: mocks.flow,
  recordDomainEvent: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireRequestContext: async () => mocks.ctx }))
vi.mock('@/lib/audit', () => ({ recordAuditInTransaction: mocks.audit }))
vi.mock('@/lib/signature-storage', () => ({ withStoredSignatureAttachment: mocks.store }))
vi.mock('@/lib/hazid-signing', () => ({
  lockHazidForSigning: mocks.lock,
  freezeHazidSigning: vi.fn(),
  requireOwnHazidSignature: vi.fn(),
  MAX_SIGNING_CREW: 250,
  SIGNING_REQUEST_DAYS: 7,
}))
import { clearCrewSignature, removeSigningCrew, signCrewMember } from './_signing-actions'

const signatureId = '20000000-0000-4000-8000-000000000002'
const assessmentId = '30000000-0000-4000-8000-000000000003'
const attachmentId = '40000000-0000-4000-8000-000000000004'
const signedAt = '2026-10-08T12:00:00.000Z'
const input = { assessmentId, signatureId, revision: 2, signedAt }
let tx: ReturnType<typeof database>
function database(results: unknown[][], updated: unknown[] = [{ id: signatureId }]) {
  const conditions: SQL[] = []
  const select = vi.fn(() => {
    const rows = results.shift() ?? []
    const chain = {
      from: () => chain,
      where: (condition: SQL) => {
        conditions.push(condition)
        return chain
      },
      for: () => chain,
      limit: async () => rows,
    }
    return chain
  })
  const set = vi.fn()
  const remove = vi.fn()
  return {
    select,
    set,
    remove,
    conditions,
    update: () => ({
      set: (value: unknown) => {
        set(value)
        return {
          where: (condition: SQL) => {
            conditions.push(condition)
            return { returning: async () => updated }
          },
        }
      },
    }),
    delete: () => ({ where: remove }),
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.lock.mockResolvedValue({
    id: assessmentId,
    locked: true,
    signingRevision: 2,
    signingFrozenAt: new Date(),
  })
  mocks.ctx.db.mockImplementation(async (run) => run(tx))
  mocks.store.mockImplementation(async (_ctx, _ink, run) => run(tx, attachmentId))
})
describe('submitted JSA signature mutations', () => {
  it('captures late signatures atomically while retaining the one-time ink guard', async () => {
    tx = database([[{ assessmentId }], [{ personId: null, name: 'Visitor' }]])
    expect(await signCrewMember(signatureId, 2, 'data:image/png;base64,test')).toMatchObject({
      ok: true,
    })
    const where = new PgDialect().sqlToQuery(tx.conditions.at(-1)!)
    expect(where.sql).toContain('"signature_attachment_id" is null')
    expect(where.params).toContain(mocks.ctx.tenantId)
    expect(where.params).toContain(2)
    expect(mocks.flow).toHaveBeenCalledWith(
      tx,
      mocks.ctx,
      expect.objectContaining({ occurrenceKey: `${signatureId}:${attachmentId}` }),
    )
    expect(mocks.audit).toHaveBeenCalledWith(
      tx,
      mocks.ctx,
      expect.objectContaining({ action: 'sign' }),
    )
    expect(mocks.evidence).toHaveBeenCalledWith(
      tx,
      mocks.ctx.tenantId,
      expect.objectContaining({ sourceModule: 'hazard_assessment' }),
    )
  })
  it('rejects attempts to overwrite saved ink', async () => {
    tx = database([[{ assessmentId }], [{ personId: null, name: 'Visitor' }]], [])
    expect(await signCrewMember(signatureId, 2, 'ink')).toEqual({
      ok: false,
      error: 'This signer has already signed',
    })
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.evidence).not.toHaveBeenCalled()
  })
  it('clears only the chosen current signature and revokes the old personal request', async () => {
    tx = database([
      [
        {
          signerName: 'Visitor',
          signatureAttachmentId: attachmentId,
          signedAt: new Date(signedAt),
        },
      ],
    ])
    expect(await clearCrewSignature(input)).toMatchObject({ ok: true })
    expect(tx.set).toHaveBeenCalledExactlyOnceWith({
      signatureAttachmentId: null,
      signedAt: null,
      requestId: null,
      requestedAt: null,
      requestExpiresAt: null,
    })
    expect(tx.remove).not.toHaveBeenCalled()
    expect(mocks.audit).toHaveBeenCalledWith(
      tx,
      mocks.ctx,
      expect.objectContaining({
        before: { signer: 'Visitor', signatureAttachmentId: attachmentId, signedAt },
      }),
    )
    expect(mocks.evidence).toHaveBeenCalledTimes(1)
  })
  it('removes a signed slot with retained audit evidence and immediate compliance refresh', async () => {
    tx = database([
      [
        {
          signerName: 'Visitor',
          signatureAttachmentId: attachmentId,
          signedAt: new Date(signedAt),
        },
      ],
    ])
    expect(await removeSigningCrew(input)).toMatchObject({ ok: true })
    expect(tx.remove).toHaveBeenCalledTimes(1)
    expect(tx.set).not.toHaveBeenCalled()
    expect(mocks.audit).toHaveBeenCalledWith(
      tx,
      mocks.ctx,
      expect.objectContaining({
        action: 'delete',
        before: expect.objectContaining({ signatureAttachmentId: attachmentId }),
      }),
    )
    expect(mocks.evidence).toHaveBeenCalledTimes(1)
  })
  it.each([clearCrewSignature, removeSigningCrew])(
    'rejects a stale page after the signer signs again',
    async (action) => {
      tx = database([
        [
          {
            signerName: 'Visitor',
            signatureAttachmentId: attachmentId,
            signedAt: new Date('2026-10-08T13:00:00.000Z'),
          },
        ],
      ])
      expect(await action(input)).toEqual({
        ok: false,
        error: 'The signature changed. Refresh the crew before continuing.',
      })
      expect(tx.set).not.toHaveBeenCalled()
      expect(tx.remove).not.toHaveBeenCalled()
    },
  )
  it('rejects an old signing revision before reading or changing signatures', async () => {
    tx = database([])
    expect(await clearCrewSignature({ ...input, revision: 1 })).toMatchObject({ ok: false })
    expect(tx.select).not.toHaveBeenCalled()
    expect(tx.set).not.toHaveBeenCalled()
  })
  it('requires edit permission and assessment visibility even when locked', async () => {
    tx = database([])
    mocks.lock.mockRejectedValueOnce(new HazidSigningError('Assessment not found'))
    expect(await clearCrewSignature(input)).toEqual({ ok: false, error: 'Assessment not found' })
    expect(mocks.assertCan).toHaveBeenCalledWith(mocks.ctx, 'hazid.update')
    expect(tx.set).not.toHaveBeenCalled()
  })
})
