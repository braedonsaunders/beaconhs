import { Queue } from 'bullmq'
import { getConnection } from '../connection'
import {
  assertOptionalString,
  assertQueueJobId,
  assertRelativeAppPath,
  assertString,
  assertUuid,
} from '../validation'

export type PushJobData = {
  tenantId: string
  userId: string
  subscriptionId: string
  title: string
  body?: string
  linkPath?: string
}

let pushQueue: Queue<PushJobData> | undefined

export function assertPushJobData(data: PushJobData): void {
  assertUuid(data.tenantId, 'Push tenantId')
  assertString(data.userId, 'Push userId', { min: 1, max: 200 })
  assertUuid(data.subscriptionId, 'Push subscriptionId')
  assertString(data.title, 'Push title', { min: 1, max: 500 })
  assertOptionalString(data.body, 'Push body', 20_000)
  assertRelativeAppPath(data.linkPath, 'Push linkPath')
}

function getPushQueue(): Queue<PushJobData> {
  pushQueue ??= new Queue<PushJobData>('push', {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
    },
  })
  return pushQueue
}

export async function enqueuePush(data: PushJobData, jobId: string) {
  assertPushJobData(data)
  assertQueueJobId(jobId, 'Push jobId')
  return getPushQueue().add('send', data, { jobId })
}
