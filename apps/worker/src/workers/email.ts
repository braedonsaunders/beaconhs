import type { Job } from 'bullmq'
import { sendEmail } from '@beaconhs/emails'
import type { EmailJobData } from '@beaconhs/jobs'

export async function processEmail(job: Job<EmailJobData>): Promise<void> {
  await sendEmail({
    to: job.data.to,
    subject: job.data.subject,
    html: job.data.html,
    text: job.data.text,
    from: job.data.from,
    replyTo: job.data.replyTo,
  })
}
