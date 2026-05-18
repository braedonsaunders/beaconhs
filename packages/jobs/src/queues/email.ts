import { Queue } from 'bullmq'
import { connection } from '../connection'

export type EmailJobData = {
  to: string | string[]
  subject: string
  html: string
  text: string
  from?: string
  replyTo?: string
  // For audit-log fan-out
  meta?: { tenantId?: string; userId?: string; category?: string }
}

export const emailQueue = new Queue<EmailJobData>('emails', {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 7 * 24 * 3600 },
    removeOnFail: { age: 30 * 24 * 3600 },
  },
})

export async function enqueueEmail(data: EmailJobData) {
  await emailQueue.add('send', data)
}
