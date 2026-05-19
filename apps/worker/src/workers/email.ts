import type { Job } from 'bullmq'
import { eq } from 'drizzle-orm'
import { sendEmail } from '@beaconhs/emails'
import { db, withSuperAdmin } from '@beaconhs/db'
import { emailLog } from '@beaconhs/db/schema'
import type { EmailJobData } from '@beaconhs/jobs'

// Email worker.
//
// On every dispatch we instrument an `email_log` row so the support team
// can answer "did X get this email?" from the /admin/email-log viewer.
// The row is upserted: first inserted with status='queued' / sent timestamps
// null, then updated to 'sent' (+ provider message id) on success or
// 'failed' (+ errorMessage) on exception. We never throw away the audit
// row even when the upstream Resend call blows up; the row exists so the
// failure shows up in the viewer.
//
// `withSuperAdmin(db, ...)` runs the writes outside any tenant scope —
// the email worker is tenant-agnostic and tenantId is materialised from
// the job payload meta when provided (else null = platform send).

function asArray(v: string | string[]): string[] {
  return Array.isArray(v) ? v : [v]
}

function byteLen(s: string | undefined | null): number {
  if (!s) return 0
  return Buffer.byteLength(s, 'utf8')
}

export async function processEmail(job: Job<EmailJobData>): Promise<void> {
  const recipients = asArray(job.data.to)
  const tenantId = job.data.meta?.tenantId ?? null
  const categoryKey = job.data.meta?.category ?? null
  const from = job.data.from ?? process.env.RESEND_FROM ?? 'BeaconHS <noreply@beaconhs.app>'

  // 1. Insert the queued row first so the viewer can show in-flight sends.
  const logId = await withSuperAdmin(db, async (tx) => {
    const [row] = await tx
      .insert(emailLog)
      .values({
        tenantId,
        jobId: String(job.id ?? ''),
        recipients,
        recipientPrimary: recipients[0] ?? null,
        cc: [],
        bcc: [],
        fromAddr: from,
        replyToAddr: job.data.replyTo ?? null,
        subject: job.data.subject,
        htmlSize: byteLen(job.data.html),
        textSize: byteLen(job.data.text),
        htmlBody: job.data.html,
        textBody: job.data.text,
        status: 'queued',
        categoryKey,
        meta: {
          ...(job.data.meta ?? {}),
          attempt: job.attemptsMade,
        },
      })
      .returning({ id: emailLog.id })
    return row?.id ?? null
  })

  // 2. Actually send. On failure we update the row + rethrow so BullMQ
  // can retry; on success we update with the provider message id.
  try {
    const result = await sendEmail({
      to: job.data.to,
      subject: job.data.subject,
      html: job.data.html,
      text: job.data.text,
      from: job.data.from,
      replyTo: job.data.replyTo,
    })

    if (logId) {
      await withSuperAdmin(db, (tx) =>
        tx
          .update(emailLog)
          .set({
            status: 'sent',
            providerMessageId: result.id,
            sentAt: new Date(),
          })
          .where(eqLogId(logId)),
      )
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (logId) {
      await withSuperAdmin(db, (tx) =>
        tx
          .update(emailLog)
          .set({
            status: 'failed',
            errorMessage: message,
          })
          .where(eqLogId(logId)),
      )
    }
    throw err
  }
}

function eqLogId(id: string) {
  return eq(emailLog.id, id)
}
