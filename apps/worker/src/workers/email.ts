import type { Job } from 'bullmq'
import { eq } from 'drizzle-orm'
import { sendEmail, sendVia } from '@beaconhs/emails'
import { db, withSuperAdmin } from '@beaconhs/db'
import { emailLog } from '@beaconhs/db/schema'
import type { EmailJobData } from '@beaconhs/jobs'
import { resolveEmailDelivery } from '../lib/resolve-email-transport'

// Email worker.
//
// On every dispatch we instrument an `email_log` row so the support team
// can answer "did X get this email?" from the /admin/email-log viewer.
// The row is upserted: first inserted with status='queued' / sent timestamps
// null, then updated to 'sent' (+ provider message id) on success or
// 'failed' (+ errorMessage) on exception. We never throw away the audit
// row even when the upstream send blows up; the row exists so the failure
// shows up in the viewer.
//
// The transport is resolved per send from the platform + tenant config
// (resolve-email-transport): a tenant's own provider, the platform global
// default, or the RESEND_* environment fallback. When the platform admin has
// globally DISABLED email, the send is recorded as suppressed and skipped (no
// retry). `withSuperAdmin(db, ...)` runs the writes outside any tenant scope —
// tenantId is materialised from the job payload meta (else null = platform send).

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

  // Resolve the effective transport first so we can record the provider used
  // (and the actual sender) on the log row, and honour the global kill switch.
  const delivery = await resolveEmailDelivery(tenantId)
  const suppressed = delivery.kind === 'suppressed'
  const transport = delivery.kind === 'transport' ? delivery.transport : null
  const providerKey = suppressed ? 'suppressed' : (transport?.provider ?? 'env')
  const from =
    job.data.from ?? transport?.from ?? process.env.RESEND_FROM ?? 'BeaconHS <noreply@beaconhs.app>'

  // 1. Insert the log row. For a suppressed send it is terminal (failed +
  // suppressed flag); otherwise it starts 'queued' so the viewer shows it in
  // flight.
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
        status: suppressed ? 'failed' : 'queued',
        categoryKey,
        errorMessage: suppressed
          ? 'Email delivery is disabled by the platform administrator.'
          : null,
        meta: {
          ...(job.data.meta ?? {}),
          attempt: job.attemptsMade,
          provider: providerKey,
          ...(suppressed ? { suppressed: true } : {}),
        },
      })
      .returning({ id: emailLog.id })
    return row?.id ?? null
  })

  // Global kill switch: recorded, not sent, not retried.
  if (suppressed) return

  // 2. Actually send via the resolved transport (or the env fallback). On
  // failure we update the row + rethrow so BullMQ can retry; on success we
  // update with the provider message id.
  try {
    const payload = {
      to: job.data.to,
      subject: job.data.subject,
      html: job.data.html,
      text: job.data.text,
      from,
      replyTo: job.data.replyTo,
      attachments: job.data.attachments,
    }
    const result = transport ? await sendVia(transport, payload) : await sendEmail(payload)

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
