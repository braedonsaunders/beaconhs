import { createHash } from 'node:crypto'
import { Queue, type JobsOptions } from 'bullmq'
import {
  normalizeEmailDeliveryInput,
  type EmailAttachmentPayload,
} from '@beaconhs/email-render/delivery-input'
import { getConnection } from '../connection'

export type EmailAttachment = EmailAttachmentPayload

export type EmailJobData = {
  /** One recipient per durable job prevents address disclosure between users. */
  to: string
  subject: string
  html: string
  text: string
  attachments?: EmailAttachment[]
  // For audit-log fan-out
  meta?: {
    tenantId?: string
    userId?: string
    category?: string
    /** Re-check the tenant category kill switch immediately before delivery. */
    automaticNotification?: boolean
    reportRunDeliveryId?: string
  }
}

export type EnqueueEmailData = Omit<EmailJobData, 'to'> & { to: string | string[] }

let emailQueue: Queue<EmailJobData> | undefined

function getEmailQueue(): Queue<EmailJobData> {
  emailQueue ??= new Queue<EmailJobData>('emails', {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
    },
  })
  return emailQueue
}

function fanoutOptions(
  options: JobsOptions | undefined,
  recipient: string,
): JobsOptions | undefined {
  if (!options?.jobId) return options
  const digest = createHash('sha256')
    .update(options.jobId)
    .update('\0')
    .update(recipient.toLowerCase())
    .digest('hex')
  return { ...options, jobId: `email-fanout|${digest}` }
}

export async function enqueueEmail(data: EnqueueEmailData, options?: JobsOptions) {
  const normalized = normalizeEmailDeliveryInput(data)
  const queue = getEmailQueue()
  if (normalized.to.length === 1) {
    return [await queue.add('send', { ...data, ...normalized, to: normalized.to[0]! }, options)]
  }

  return queue.addBulk(
    normalized.to.map((recipient) => ({
      name: 'send',
      data: { ...data, ...normalized, to: recipient },
      opts: fanoutOptions(options, recipient),
    })),
  )
}
