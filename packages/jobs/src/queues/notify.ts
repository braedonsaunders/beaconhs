import { Queue, type JobsOptions } from 'bullmq'
import { getConnection } from '../connection'

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

let notifyQueue: Queue<NotifyJobData> | undefined

function getNotifyQueue(): Queue<NotifyJobData> {
  notifyQueue ??= new Queue<NotifyJobData>('notifications', {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'fixed', delay: 5_000 },
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  })
  return notifyQueue
}

export async function enqueueNotification(data: NotifyJobData, options?: JobsOptions) {
  return getNotifyQueue().add('dispatch', data, options)
}
