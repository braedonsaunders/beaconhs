import type { Job } from 'bullmq'
import { and, eq } from 'drizzle-orm'
import { sendVia } from '@beaconhs/emails'
import { db, withSuperAdmin } from '@beaconhs/db'
import { emailLog, reportRunDeliveries, reportRuns } from '@beaconhs/db/schema'
import type { EmailJobData } from '@beaconhs/jobs'
import { requireEmailTransport, resolveEmailDelivery } from '../lib/resolve-email-transport'

// Email worker.
//
// On every dispatch we instrument an `email_log` row so the support team
// can answer "did X get this email?" from the /admin/email-log viewer.
// Each delivery attempt inserts a row with status='queued' / sent timestamps
// null, then updates that row to 'sent' (+ provider message id) on success or
// 'failed' (+ errorMessage) on exception. We never throw away an attempt row
// when the upstream send blows up, so its failure remains visible in the
// viewer. A completed row for the same durable job prevents a retry from
// contacting the provider twice.
//
// The transport is resolved per send from the platform + tenant config
// (resolve-email-transport): a tenant's own provider or the platform global
// default. When the platform admin has
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
  const reportRunDeliveryId = job.data.meta?.reportRunDeliveryId ?? null
  if (reportRunDeliveryId) {
    const delivery = await withSuperAdmin(db, async (tx) => {
      const [row] = await tx
        .select({
          tenantId: reportRunDeliveries.tenantId,
          recipientEmail: reportRunDeliveries.recipientEmail,
          status: reportRunDeliveries.status,
        })
        .from(reportRunDeliveries)
        .where(eq(reportRunDeliveries.id, reportRunDeliveryId))
        .limit(1)
      return row ?? null
    })
    if (!delivery) throw new Error('Report email delivery record was not found')
    if (delivery.tenantId !== tenantId) throw new Error('Report email delivery tenant mismatch')
    if (
      recipients.length !== 1 ||
      recipients[0]?.trim().toLowerCase() !== delivery.recipientEmail
    ) {
      throw new Error('Report email recipient does not match its delivery record')
    }
    if (delivery.status === 'sent') return
  }

  // A worker can be marked stalled after the provider succeeded but before
  // BullMQ received the processor return. If our sent audit row committed,
  // acknowledge the duplicate execution without contacting the provider.
  const durableJobId = String(job.id ?? '')
  if (durableJobId) {
    const [alreadySent] = await withSuperAdmin(db, (tx) =>
      tx
        .select({ id: emailLog.id })
        .from(emailLog)
        .where(
          and(
            eq(emailLog.jobId, durableJobId),
            eq(emailLog.status, 'sent'),
            eq(emailLog.subject, job.data.subject),
            eq(emailLog.recipientPrimary, recipients[0] ?? ''),
          ),
        )
        .limit(1),
    )
    if (alreadySent) {
      await updateReportDelivery(reportRunDeliveryId, {
        status: 'sent',
        error: null,
        sentAt: new Date(),
      })
      return
    }
  }

  // Resolve the effective transport first so we can record the provider used
  // (and the actual sender) on the log row, and honour the global kill switch.
  const delivery = await resolveEmailDelivery(tenantId)
  const suppressed = delivery.kind === 'suppressed'
  const transport = delivery.kind === 'transport' ? delivery.transport : null
  const providerKey = suppressed ? 'suppressed' : (transport?.provider ?? 'unconfigured')
  const from = transport?.from ?? 'unconfigured'

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
        replyToAddr: transport?.replyTo ?? null,
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
  if (suppressed) {
    await updateReportDelivery(reportRunDeliveryId, {
      status: 'failed',
      error: 'Email delivery is disabled by the platform administrator.',
    })
    return
  }

  // 2. Actually send via the resolved database-managed transport. On
  // failure we update the row + rethrow so BullMQ can retry; on success we
  // update with the provider message id.
  try {
    const payload = {
      to: job.data.to,
      subject: job.data.subject,
      html: job.data.html,
      text: job.data.text,
      attachments: job.data.attachments,
    }
    const result = await sendVia(requireEmailTransport(delivery), payload)

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
    await updateReportDelivery(reportRunDeliveryId, {
      status: 'sent',
      error: null,
      sentAt: new Date(),
    })
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
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)
    await updateReportDelivery(reportRunDeliveryId, {
      status: finalAttempt ? 'failed' : 'enqueued',
      error: message,
    })
    throw err
  }
}

async function updateReportDelivery(
  id: string | null,
  values: {
    status: 'enqueued' | 'sent' | 'failed'
    error: string | null
    sentAt?: Date
  },
): Promise<void> {
  if (!id) return
  await withSuperAdmin(db, async (tx) => {
    const [delivery] = await tx
      .update(reportRunDeliveries)
      .set(values)
      .where(eq(reportRunDeliveries.id, id))
      .returning({ runId: reportRunDeliveries.runId })
    if (!delivery || values.status === 'enqueued') return

    const deliveries = await tx
      .select({ status: reportRunDeliveries.status, error: reportRunDeliveries.error })
      .from(reportRunDeliveries)
      .where(eq(reportRunDeliveries.runId, delivery.runId))
    if (deliveries.some((row) => row.status === 'queued' || row.status === 'enqueued')) return

    const failures = deliveries.filter((row) => row.status === 'failed')
    await tx
      .update(reportRuns)
      .set(
        failures.length > 0
          ? {
              status: 'failed',
              error: `${failures.length} report email delivery attempt(s) failed: ${failures
                .map((row) => row.error)
                .filter(Boolean)
                .join('; ')}`,
              finishedAt: new Date(),
            }
          : { status: 'succeeded', error: null, finishedAt: new Date() },
      )
      .where(eq(reportRuns.id, delivery.runId))
  })
}

function eqLogId(id: string) {
  return eq(emailLog.id, id)
}
