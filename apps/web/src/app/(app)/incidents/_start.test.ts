import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  permission: vi.fn(),
  audit: vi.fn(),
  event: vi.fn(),
  reference: vi.fn(),
  redirect: vi.fn(),
  revalidate: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireRequestContext: mocks.auth }))
vi.mock('@beaconhs/tenant', () => ({ assertCan: mocks.permission }))
vi.mock('@/lib/audit', () => ({ recordAuditInTransaction: mocks.audit }))
vi.mock('@/lib/reference', () => ({ nextReference: mocks.reference }))
vi.mock('@beaconhs/events', () => ({ recordDomainEvent: mocks.event, moduleFlowCommand: vi.fn() }))
vi.mock('@beaconhs/integrations', () => ({ incidentCreatedEvent: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
import { startIncident } from './_start'

let returning: ReturnType<typeof vi.fn>
let values: ReturnType<typeof vi.fn>
let tx: { insert: ReturnType<typeof vi.fn> }
let ctx: { tenantId: string; membership: { id: string }; db: ReturnType<typeof vi.fn> }
beforeEach(() => {
  vi.resetAllMocks()
  returning = vi.fn().mockResolvedValue([{ id: 'incident-id', reference: 'INC-42' }])
  values = vi.fn().mockReturnValue({ returning })
  tx = { insert: vi.fn().mockReturnValue({ values }) }
  ctx = {
    tenantId: 'tenant-id',
    membership: { id: 'reporter-id' },
    db: vi.fn(async (run) => run(tx)),
  }
  mocks.auth.mockResolvedValue(ctx)
  mocks.reference.mockResolvedValue('INC-42')
})

describe('direct incident creation', () => {
  it('requires create permission before writing', async () => {
    mocks.permission.mockImplementation(() => {
      throw new Error('Forbidden')
    })
    await expect(startIncident()).rejects.toThrow('Forbidden')
    expect(mocks.permission).toHaveBeenCalledWith(ctx, 'incidents.create')
    expect(ctx.db).not.toHaveBeenCalled()
  })

  it('starts the reporter-owned record with audit and event in one transaction, then opens it', async () => {
    await startIncident()
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: ctx.tenantId,
        reference: 'INC-42',
        reportedByTenantUserId: ctx.membership.id,
        status: 'reported',
        occurredAt: expect.any(Date),
      }),
    )
    expect(mocks.audit).toHaveBeenCalledWith(
      tx,
      ctx,
      expect.objectContaining({ entityId: 'incident-id', action: 'create' }),
    )
    expect(mocks.event).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        subjectId: 'incident-id',
        dedupKey: 'incident.created:incident-id',
      }),
    )
    expect(mocks.redirect).toHaveBeenCalledWith('/incidents/incident-id')
  })

  it('fails before redirecting if creation or the transactional audit fails', async () => {
    returning.mockResolvedValueOnce([])
    await expect(startIncident()).rejects.toThrow('Incident could not be created.')
    expect(mocks.event).not.toHaveBeenCalled()
    mocks.audit.mockRejectedValueOnce(new Error('Audit unavailable'))
    await expect(startIncident()).rejects.toThrow('Audit unavailable')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})
