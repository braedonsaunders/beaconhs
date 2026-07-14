import { Queue, type JobsOptions } from 'bullmq'
import { createHash } from 'node:crypto'
import { getConnection } from '../connection'
import {
  assertIdentifier,
  assertJsonBytes,
  assertOptionalString,
  assertQueueJobId,
  assertRelativeAppPath,
  assertString,
  assertUuid,
} from '../validation'

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

const MAX_USERS_PER_JOB = 250
const MAX_USERS_PER_ENQUEUE = 100_000
const MAX_JOBS_PER_ADD_BULK = 40
const CHANNELS = new Set<NonNullable<NotifyJobData['channels']>[number]>([
  'in_app',
  'email',
  'push',
  'sms',
])

export function normalizeNotifyJobData(data: NotifyJobData): NotifyJobData {
  assertUuid(data.tenantId, 'Notification tenantId')
  if (!Array.isArray(data.userIds)) throw new Error('Notification userIds must be an array.')
  const userIds = [...new Set(data.userIds.map((id) => id.trim()).filter(Boolean))]
  if (userIds.length === 0 || userIds.length > MAX_USERS_PER_ENQUEUE) {
    throw new Error(
      `Notification userIds must contain between 1 and ${MAX_USERS_PER_ENQUEUE} recipients.`,
    )
  }
  for (const id of userIds) assertString(id, 'Notification userId', { min: 1, max: 200 })
  assertIdentifier(data.category, 'Notification category', 100)
  assertIdentifier(data.type, 'Notification type', 150)
  assertString(data.title, 'Notification title', { min: 1, max: 500 })
  assertOptionalString(data.body, 'Notification body', 20_000)
  assertRelativeAppPath(data.linkPath, 'Notification linkPath')
  assertJsonBytes(data.data ?? {}, 'Notification data', 64 * 1_024)
  if (data.channels) {
    if (
      data.channels.length === 0 ||
      data.channels.length > CHANNELS.size ||
      data.channels.some((channel) => !CHANNELS.has(channel))
    ) {
      throw new Error('Notification channels are invalid.')
    }
  }
  return { ...data, userIds, channels: data.channels ? [...new Set(data.channels)] : undefined }
}

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
  const normalized = normalizeNotifyJobData(data)
  assertQueueJobId(options?.jobId, 'Notification jobId')
  const queue = getNotifyQueue()
  if (normalized.userIds.length <= MAX_USERS_PER_JOB) {
    return queue.add('dispatch', normalized, options)
  }

  const jobs = []
  for (let offset = 0; offset < normalized.userIds.length; offset += MAX_USERS_PER_JOB) {
    const userIds = normalized.userIds.slice(offset, offset + MAX_USERS_PER_JOB)
    const jobId = options?.jobId
      ? `notification-batch|${createHash('sha256')
          .update(`${normalized.tenantId}\0${options.jobId}\0${userIds.join('\0')}`)
          .digest('hex')}`
      : undefined
    jobs.push({
      name: 'dispatch',
      data: { ...normalized, userIds },
      opts: { ...options, ...(jobId ? { jobId } : {}) },
    })
  }
  const added = []
  for (let offset = 0; offset < jobs.length; offset += MAX_JOBS_PER_ADD_BULK) {
    added.push(...(await queue.addBulk(jobs.slice(offset, offset + MAX_JOBS_PER_ADD_BULK))))
  }
  return added
}
