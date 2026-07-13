import { Queue, type JobsOptions } from 'bullmq'
import { getConnection } from '../connection'

export type EmailAttachment = {
  filename: string
  /** base64-encoded file contents (BullMQ payloads must be JSON-serializable). */
  content: string
  contentType?: string
}

export type EmailJobData = {
  to: string | string[]
  subject: string
  html: string
  text: string
  attachments?: EmailAttachment[]
  // For audit-log fan-out
  meta?: {
    tenantId?: string
    userId?: string
    category?: string
    reportRunDeliveryId?: string
  }
}

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

export async function enqueueEmail(data: EmailJobData, options?: JobsOptions) {
  return getEmailQueue().add('send', data, options)
}
