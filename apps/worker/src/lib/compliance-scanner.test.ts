import { beforeEach, expect, it, vi } from 'vitest'
import { tenants } from '@beaconhs/db/schema'
const mocks = vi.hoisted(() => ({
  materialize: vi.fn(async () => []),
  maintenance: vi.fn(async () => 0),
  queuedMaintenance: vi.fn(async () => ({ errors: 0 })),
  rows: [] as { id: string; enabled: boolean; cron: string; tz: string }[],
}))
function query(rows: unknown[]) {
  const chain: Record<string, unknown> = {}
  for (const name of ['where', 'orderBy', 'limit', 'for', 'leftJoin']) chain[name] = () => chain
  chain.then = (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve)
  return chain
}
const tx = {
  select: () => ({ from: (table: unknown) => query(table === tenants ? mocks.rows : []) }),
  update: () => ({ set: () => ({ where: async () => undefined }) }),
}
vi.mock('@beaconhs/db', () => ({
  db: {},
  withTenant: async (_db: unknown, _id: string, run: (t: unknown) => Promise<unknown>) => run(tx),
  withSuperAdmin: async (_db: unknown, run: (t: unknown) => Promise<unknown>) => run(tx),
}))
vi.mock('@beaconhs/compliance', () => ({
  materializeTenant: mocks.materialize,
  resolveComplianceReminderPolicy: vi.fn(),
}))
vi.mock('@beaconhs/events', () => ({ emitComplianceTransitions: vi.fn() }))
vi.mock('./equipment-maintenance-scanner', () => ({
  scanTenantEquipmentMaintenance: mocks.maintenance,
  publishQueuedEquipmentMaintenance: mocks.queuedMaintenance,
}))
import { scanCompliance } from './compliance-scanner'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rows = []
})
it('refreshes paused tenants and tenants outside their reminder hour on every tick', async () => {
  mocks.rows = [
    { id: 'paused', enabled: false, cron: '0 8 * * *', tz: 'America/Toronto' },
    { id: 'enabled', enabled: true, cron: '0 8 * * *', tz: 'America/Toronto' },
  ]
  const scheduledFor = new Date('2026-10-20T16:00:00Z')
  const result = await scanCompliance(scheduledFor)
  expect(result.errors).toBe(0)
  expect(result.due).toBe(2)
  expect(mocks.materialize.mock.calls.map((call: unknown[]) => call[1])).toEqual([
    'paused',
    'enabled',
  ])
  expect(mocks.maintenance).not.toHaveBeenCalled()
})

it('delivers equipment reminders on their own schedule while scoreboard evaluation continues', async () => {
  mocks.rows = [
    { id: 'equipment-on', enabled: true, cron: '0 8 * * *', tz: 'America/Toronto' },
    { id: 'equipment-off', enabled: false, cron: '0 8 * * *', tz: 'America/Toronto' },
  ]
  await scanCompliance(new Date('2026-10-20T12:00:00Z'))
  expect(mocks.maintenance).toHaveBeenCalledExactlyOnceWith('equipment-on')
  expect(mocks.materialize).toHaveBeenCalledTimes(2)
})
