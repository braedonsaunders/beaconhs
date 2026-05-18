import { Queue } from 'bullmq'
import { connection } from '../connection'

export type NotifyJobData = {
  tenantId: string
  userIds: string[]
  category: string
  type: string
  title: string
  body?: string
  linkPath?: string
  data?: Record<string, unknown>
  isCritical?: boolean
  // Channel hints (still subject to user preferences)
  channels?: ('in_app' | 'email' | 'push' | 'sms')[]
}

export const notifyQueue = new Queue<NotifyJobData>('notifications', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'fixed', delay: 5_000 },
    removeOnComplete: { age: 24 * 3600 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
})

export async function enqueueNotification(data: NotifyJobData) {
  await notifyQueue.add('dispatch', data)
}
