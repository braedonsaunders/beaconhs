import { expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import type { PushJobData } from '@beaconhs/jobs'
const mocks = vi.hoisted(() => ({
  enabled: vi.fn(async () => false),
  send: vi.fn(),
  select: vi.fn(),
}))
vi.mock('@beaconhs/events', () => ({ isNotificationCategoryEnabled: mocks.enabled }))
vi.mock('@beaconhs/db', () => ({
  db: {},
  withTenant: async (_db: unknown, _tenant: string, run: (tx: unknown) => Promise<unknown>) =>
    run({ select: mocks.select }),
}))
vi.mock('@beaconhs/jobs', async (original) => ({
  ...(await original<typeof import('@beaconhs/jobs')>()),
  sendWebPushNotification: mocks.send,
}))
import { processPush } from './push'
it('drops queued pushes when reminders or their category are paused', async () => {
  await expect(
    processPush({
      data: {
        tenantId: '00000000-0000-4000-8000-000000000001',
        userId: 'worker',
        subscriptionId: '00000000-0000-4000-8000-000000000002',
        category: 'compliance',
        title: 'Overdue',
      },
    } as Job<PushJobData>),
  ).resolves.toBeUndefined()
  expect(mocks.enabled).toHaveBeenCalledWith(
    expect.anything(),
    '00000000-0000-4000-8000-000000000001',
    'compliance',
  )
  expect(mocks.select).not.toHaveBeenCalled()
  expect(mocks.send).not.toHaveBeenCalled()
})
