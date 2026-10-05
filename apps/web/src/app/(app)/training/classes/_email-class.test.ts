import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  permission: vi.fn(),
  configured: vi.fn(),
  event: vi.fn(),
  audit: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireRequestContext: mocks.context }))
vi.mock('@beaconhs/tenant', () => ({ assertCan: mocks.permission }))
vi.mock('@/lib/training-class-email', () => ({
  assertClassEmailConfigured: mocks.configured,
  ClassEmailError: class extends Error {},
}))
vi.mock('@beaconhs/events', () => ({
  recordModuleFlowEvent: mocks.event,
  recordDomainEvent: vi.fn(),
  moduleFlowCommand: vi.fn(),
}))
vi.mock('@/lib/audit', () => ({ recordAuditInTransaction: mocks.audit, recordAudit: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@beaconhs/compliance', () => ({ materializeEvidenceTargetObligations: vi.fn() }))
import { emailClass } from './_actions'
const id = '10000000-0000-4000-8000-000000000001'
function setup(roster = 2, overrides: Record<string, unknown> = {}) {
  const rows = [
    [
      {
        id,
        title: 'Crane training',
        startsAt: new Date('2030-10-30T11:30:00Z'),
        cancelledAt: null,
        completedAt: null,
        ...overrides,
      },
    ],
    [{ total: roster }],
  ]
  const updates: unknown[] = []
  const tx = {
    select: () => {
      const result = rows.shift()
      const query = {
        from: () => query,
        where: () => query,
        limit: () => query,
        for: async () => result,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
      }
      return query
    },
    update: () => ({
      set: (value: unknown) => {
        updates.push(value)
        return { where: vi.fn().mockResolvedValue(undefined) }
      },
    }),
  }
  mocks.context.mockResolvedValue({
    tenantId: id,
    userId: id,
    membership: { id },
    personId: null,
    timezone: 'America/Toronto',
    db: (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  })
  const form = new FormData()
  form.set('id', id)
  return { form, updates }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.configured.mockResolvedValue(undefined)
})
describe('manual initial class email', () => {
  it('refuses an empty roster without queuing or marking an initial email', async () => {
    const { form, updates } = setup(0)
    expect(await emailClass(form)).toEqual({
      error: 'Add employees to the roster before emailing the class.',
    })
    expect(mocks.event).not.toHaveBeenCalled()
    expect(updates).toEqual([])
  })
  it.each([
    { cancelledAt: new Date() },
    { completedAt: new Date() },
    { startsAt: new Date('2020-01-01') },
    { title: 'Untitled class' },
  ])('refuses an unready class %j', async (overrides) => {
    const { form } = setup(2, overrides)
    expect((await emailClass(form)).error).toBeTruthy()
    expect(mocks.event).not.toHaveBeenCalled()
  })
  it('records the announcement and actor with a durable event inside the tenant transaction', async () => {
    const { form, updates } = setup()
    expect(await emailClass(form)).toEqual({})
    expect(mocks.permission).toHaveBeenCalledWith(expect.anything(), 'training.class.manage')
    expect(mocks.configured).toHaveBeenCalledWith(expect.anything(), id, 'class_confirmed')
    expect(mocks.event).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ event: 'class_confirmed', subjectId: id }),
    )
    expect(updates[0]).toEqual(
      expect.objectContaining({
        emailQueuedAt: expect.any(Date),
        emailActor: expect.objectContaining({ timezone: 'America/Toronto' }),
      }),
    )
    expect(mocks.audit).toHaveBeenCalled()
  })
})
