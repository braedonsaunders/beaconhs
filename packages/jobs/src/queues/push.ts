import { Queue } from 'bullmq'
import { getConnection } from '../connection'

export type PushJobData = {
  tenantId: string
  userId: string
  subscriptionId: string
  title: string
  body?: string
  linkPath?: string
}

let pushQueue: Queue<PushJobData> | undefined

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
  return getPushQueue().add('send', data, { jobId })
}
