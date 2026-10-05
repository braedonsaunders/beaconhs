import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ super: vi.fn(), tenant: vi.fn(), event: vi.fn() }))
vi.mock('@beaconhs/db', () => ({ db: {}, withSuperAdmin: mocks.super, withTenant: mocks.tenant }))
vi.mock('@beaconhs/events', () => ({ recordModuleFlowEvent: mocks.event }))
import { scanTrainingClassReminders } from './training-class-reminders'
const now = new Date('2026-10-29T12:00:00Z')
function setup(overrides: Record<string, unknown> = {}, roster = true) {
  const cls = {
    id: 'class',
    tenantId: 'tenant',
    emailQueuedAt: new Date('2026-10-20'),
    emailActor: {
      userId: 'manager',
      membershipId: 'member',
      personId: null,
      timezone: 'America/Toronto',
    },
    reminderHours: 24,
    startsAt: new Date('2026-10-30T11:30:00Z'),
    cancelledAt: null,
    completedAt: null,
    reminderQueuedFor: null,
    ...overrides,
  }
  const tx = {
    select: () => {
      const query = {
        from: () => query,
        where: () => query,
        limit: () => query,
        for: async () => [cls],
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(roster ? [{ id: 'attendee' }] : []).then(resolve),
      }
      return query
    },
    update: () => ({
      set: (patch: object) => {
        Object.assign(cls, patch)
        return { where: vi.fn().mockResolvedValue(undefined) }
      },
    }),
    insert: () => ({ values: vi.fn().mockResolvedValue(undefined) }),
  }
  mocks.super.mockResolvedValue([{ id: cls.id, tenantId: cls.tenantId }])
  mocks.tenant.mockImplementation((_db, _tenant, fn) => fn(tx))
  return cls
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.event.mockResolvedValue('event')
})
describe('optional class reminders', () => {
  it.each([
    { emailQueuedAt: null },
    { reminderHours: null },
    { cancelledAt: now },
    { completedAt: now },
    { startsAt: new Date('2026-10-29T11:00:00Z') },
    { startsAt: new Date('2026-11-30T11:30:00Z') },
  ])(
    'does not announce an unconfirmed, disabled, cancelled, completed, past or distant class %j',
    async (overrides) => {
      setup(overrides)
      expect(await scanTrainingClassReminders(now)).toBe(0)
      expect(mocks.event).not.toHaveBeenCalled()
    },
  )
  it('requires an active roster even after a class was initially announced', async () => {
    setup({}, false)
    expect(await scanTrainingClassReminders(now)).toBe(0)
    expect(mocks.event).not.toHaveBeenCalled()
  })
  it('queues one reminder per start time and preserves the manager timezone', async () => {
    const cls = setup()
    expect(await scanTrainingClassReminders(now)).toBe(1)
    expect(await scanTrainingClassReminders(now)).toBe(0)
    expect(mocks.event).toHaveBeenCalledTimes(1)
    expect(mocks.event).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ timezone: 'America/Toronto' }),
      expect.objectContaining({
        event: 'class_reminder',
        occurrenceKey: cls.startsAt.toISOString(),
      }),
    )
  })
  it('queues a new reminder after the class is moved to another upcoming date', async () => {
    setup({ reminderQueuedFor: new Date('2026-10-25') })
    expect(await scanTrainingClassReminders(now)).toBe(1)
  })
})
