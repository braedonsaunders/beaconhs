// AI queue worker: generates queued brief runs (scheduled and "Run now"),
// stores the evidence, result, and PDF on the run, then delivers it by email
// and in-app notification. Email workers set the run's terminal status once
// every delivery has finished.

import type { Job } from 'bullmq'
import { and, desc, eq, isNull, lt, ne } from 'drizzle-orm'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import {
  attachments,
  briefRunDeliveries,
  briefRuns,
  briefSchedules,
  departments,
  tenants,
  tenantUsers,
  type BriefRunDelivery,
} from '@beaconhs/db/schema'
import { assertAiJobData, enqueueEmail, enqueueNotification, type AiJobData } from '@beaconhs/jobs'
import { resolveTenantAi } from '@beaconhs/ai/tenant-config'
import {
  BRIEF_LIMITS,
  escapeHtml,
  generateBrief,
  localDate,
  renderBriefEmailHtml,
  renderBriefPdfBody,
  renderBriefText,
  resolveBriefRecipients,
  type ResolvedBriefWindow,
} from '@beaconhs/briefs'
import { can } from '@beaconhs/tenant'
import { renderHtmlDocumentPdf } from '@beaconhs/forms-pdf'
import { deleteObject, newAttachmentKey, putObject, resolveTenantLogoUrl } from '@beaconhs/storage'
import { appBaseUrl } from '../lib/app-base-url'
import { resolveRunAsContext } from '../lib/run-as-context'

const MAX_EMAIL_ATTACHMENT_BYTES = 10 * 1024 * 1024

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
    .slice(0, 4_000)
}

export async function processAiJob(job: Job<AiJobData>): Promise<void> {
  assertAiJobData(job.data)
  const { tenantId, runId } = job.data
  const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)
  try {
    await runBrief(tenantId, runId)
  } catch (error) {
    const message = errorText(error)
    console.error(`[briefs] run ${runId} failed:`, message)
    const failed = await withSuperAdmin(db, (tx) =>
      tx
        .update(briefRuns)
        .set({ status: finalAttempt ? 'failed' : 'queued', error: message, finishedAt: new Date() })
        .where(and(eq(briefRuns.id, runId), eq(briefRuns.tenantId, tenantId)))
        .returning({
          runAs: briefRuns.runAsTenantUserId,
          briefId: briefRuns.briefId,
          briefName: briefRuns.briefName,
        }),
    )
    if (finalAttempt && failed[0]?.runAs) await notifyOwnerOfFailure(tenantId, runId, failed[0])
    throw error
  }
}

async function notifyOwnerOfFailure(
  tenantId: string,
  runId: string,
  run: { runAs: string | null; briefId: string; briefName: string },
) {
  const owner = await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({ userId: tenantUsers.userId })
      .from(tenantUsers)
      .where(and(eq(tenantUsers.id, run.runAs!), eq(tenantUsers.tenantId, tenantId)))
      .limit(1)
    return row?.userId ?? null
  })
  if (!owner) return
  await enqueueNotification(
    {
      tenantId,
      userIds: [owner],
      category: 'brief',
      type: 'brief.failed',
      title: `Brief failed: ${run.briefName}`,
      body: 'Open the run to see the error and run it again.',
      linkPath: `/reports/briefs/${run.briefId}/runs/${runId}`,
      channels: ['in_app', 'email'],
      delivery: 'immediate',
    },
    { jobId: `brief-failed|${runId}` },
  ).catch((error: unknown) => console.warn('[briefs] failure notice not queued:', errorText(error)))
}

async function runBrief(tenantId: string, runId: string): Promise<void> {
  const loaded = await withSuperAdmin(db, async (tx) => {
    const [row] = await tx
      .select({ run: briefRuns, tenant: tenants, departmentName: departments.name })
      .from(briefRuns)
      .innerJoin(tenants, eq(tenants.id, briefRuns.tenantId))
      .leftJoin(
        departments,
        and(
          eq(departments.tenantId, briefRuns.tenantId),
          eq(departments.id, briefRuns.departmentId),
        ),
      )
      .where(and(eq(briefRuns.id, runId), eq(briefRuns.tenantId, tenantId)))
      .limit(1)
    return row ?? null
  })
  if (!loaded) throw new Error(`Brief run ${runId} was not found`)
  const { run, tenant } = loaded
  if (run.status === 'succeeded') return
  if (!run.runAsTenantUserId) throw new Error('Queued brief runs need a run-as member')

  await withSuperAdmin(db, (tx) =>
    tx
      .update(briefRuns)
      .set({ status: 'running', error: null, startedAt: new Date(), finishedAt: null })
      .where(and(eq(briefRuns.id, runId), eq(briefRuns.tenantId, tenantId))),
  )

  const { requestCtx } = await withTenant(db, tenantId, (tx) =>
    resolveRunAsContext(
      tx,
      tenantId,
      { tenantUserId: run.runAsTenantUserId!, roleId: run.runAsRoleId },
      'Brief',
    ),
  )
  if (
    !requestCtx.isSuperAdmin &&
    !can(requestCtx, 'briefs.read') &&
    !can(requestCtx, 'briefs.manage')
  ) {
    throw new Error('The brief run-as member no longer has access to AI briefs')
  }

  const previous = run.specSnapshot.compareWithPrevious
    ? await withTenant(db, tenantId, async (tx) => {
        const [row] = await tx
          .select({ windowLabel: briefRuns.windowLabel, result: briefRuns.result })
          .from(briefRuns)
          .where(
            and(
              eq(briefRuns.briefId, run.briefId),
              eq(briefRuns.status, 'succeeded'),
              ne(briefRuns.id, run.id),
              ne(briefRuns.trigger, 'preview'),
              lt(briefRuns.windowEnd, run.windowEnd),
              run.departmentId
                ? eq(briefRuns.departmentId, run.departmentId)
                : isNull(briefRuns.departmentId),
            ),
          )
          .orderBy(desc(briefRuns.windowEnd))
          .limit(1)
        return row?.result ? { windowLabel: row.windowLabel, result: row.result } : null
      })
    : null

  const ai = await resolveTenantAi(tenantId, { tenantUserId: run.runAsTenantUserId })
  // Day bounds in the run's own timezone (sources compare local dates).
  const window: ResolvedBriefWindow = {
    start: run.windowStart,
    end: run.windowEnd,
    firstDay: localDate(run.windowStart, run.timezone),
    lastDay: localDate(new Date(run.windowEnd.getTime() - 1), run.timezone),
    label: run.windowLabel,
    timezone: run.timezone,
  }

  const generated = await generateBrief({
    ctx: requestCtx,
    briefName: run.briefName,
    spec: run.specSnapshot,
    specVersion: run.specVersion,
    window,
    scope: { departmentId: run.departmentId, departmentName: loaded.departmentName ?? null },
    ai: { config: ai.config, reason: ai.reason },
    previous,
  })

  const runPath = `/reports/briefs/${run.briefId}/runs/${run.id}`
  const renderInput = {
    briefName: run.briefName,
    tenantName: tenant.name,
    logoUrl: await resolveTenantLogoUrl({ tenantId, logoUrl: tenant.branding.logoUrl }),
    accentColor: tenant.branding.primaryColor ?? null,
    result: generated.result,
    evidence: generated.evidence,
    appUrl: appBaseUrl(),
    runPath,
    generatedAt: new Date(),
    modelLabel: generated.aiMeta.model,
  }

  // Store the PDF with the run so the archive keeps exactly what was sent.
  const pdf = await renderHtmlDocumentPdf({
    bodyHtml: renderBriefPdfBody(renderInput),
    paperSize: 'letter',
    orientation: 'portrait',
    marginMm: 10,
    footerHtml: `${escapeHtml(run.briefName)} · ${escapeHtml(run.windowLabel)} · Page {{page}} of {{pages}}`,
  })
  const filename = `${run.briefName.replace(/[^\w.-]+/g, '-').slice(0, 60)}-${window.lastDay}.pdf`
  const r2Key = newAttachmentKey({ tenantId, kind: 'document', filename })
  await putObject({
    key: r2Key,
    body: pdf,
    contentType: 'application/pdf',
    contentDisposition: 'inline',
  })
  try {
    await withTenant(db, tenantId, async (tx) => {
      const [att] = await tx
        .insert(attachments)
        .values({
          tenantId,
          kind: 'document',
          r2Key,
          contentType: 'application/pdf',
          sizeBytes: pdf.length,
          filename,
        })
        .returning({ id: attachments.id })
      if (!att) throw new Error('Brief PDF attachment was not stored')
      await tx
        .update(briefRuns)
        .set({
          result: generated.result,
          evidence: generated.evidence,
          aiMeta: generated.aiMeta,
          pdfAttachmentId: att.id,
        })
        .where(and(eq(briefRuns.id, run.id), eq(briefRuns.tenantId, tenantId)))
    })
  } catch (error) {
    await deleteObject({ key: r2Key }).catch(() => undefined)
    throw error
  }

  const delivery: BriefRunDelivery = run.delivery ?? {
    userIds: [],
    groupIds: [],
    emails: [],
    subject: null,
  }
  const recipients = generated.skipped
    ? []
    : await withTenant(db, tenantId, (tx) => resolveBriefRecipients(tx, tenantId, delivery))
  if (recipients.length > BRIEF_LIMITS.recipients) {
    throw new Error(`A brief can be delivered to at most ${BRIEF_LIMITS.recipients} recipients`)
  }

  if (recipients.length > 0) {
    await withTenant(db, tenantId, (tx) =>
      tx
        .insert(briefRunDeliveries)
        .values(recipients.map((r) => ({ tenantId, runId: run.id, recipientEmail: r.email })))
        .onConflictDoNothing({
          target: [briefRunDeliveries.runId, briefRunDeliveries.recipientEmail],
        }),
    )
    const deliveries = await withTenant(db, tenantId, (tx) =>
      tx
        .select()
        .from(briefRunDeliveries)
        .where(
          and(eq(briefRunDeliveries.runId, run.id), eq(briefRunDeliveries.tenantId, tenantId)),
        ),
    )
    const subject =
      delivery.subject?.trim() ||
      `${run.briefName} — ${run.windowLabel}${loaded.departmentName ? ` · ${loaded.departmentName}` : ''}`
    const html = renderBriefEmailHtml(renderInput)
    const text = renderBriefText(renderInput)
    const pdfAttachment =
      pdf.length <= MAX_EMAIL_ATTACHMENT_BYTES
        ? [{ filename, content: pdf.toString('base64'), contentType: 'application/pdf' }]
        : undefined
    for (const row of deliveries) {
      if (row.status !== 'queued') continue
      const emailJobId = `brief-email|${row.id}`
      await enqueueEmail(
        {
          to: row.recipientEmail,
          subject,
          html,
          text,
          attachments: pdfAttachment,
          meta: { tenantId, category: 'brief', briefRunDeliveryId: row.id },
        },
        { jobId: emailJobId },
      )
      await withTenant(db, tenantId, (tx) =>
        tx
          .update(briefRunDeliveries)
          .set({ status: 'enqueued', emailJobId, error: null })
          .where(and(eq(briefRunDeliveries.id, row.id), eq(briefRunDeliveries.status, 'queued'))),
      )
    }
    const userIds = [...new Set(recipients.flatMap((r) => (r.userId ? [r.userId] : [])))]
    if (userIds.length > 0) {
      await enqueueNotification(
        {
          tenantId,
          userIds,
          category: 'brief',
          type: 'brief.delivered',
          title: `${run.briefName} — ${run.windowLabel}`,
          body: generated.result.headline,
          linkPath: runPath,
          channels: ['in_app', 'push'],
          delivery: 'immediate',
        },
        { jobId: `brief-delivered|${run.id}` },
      )
    }
  }

  await withSuperAdmin(db, async (tx) => {
    if (recipients.length === 0) {
      await tx
        .update(briefRuns)
        .set({ status: 'succeeded', finishedAt: new Date() })
        .where(and(eq(briefRuns.id, run.id), eq(briefRuns.tenantId, tenantId)))
    }
    if (run.scheduleId) {
      await tx
        .update(briefSchedules)
        .set({ lastRunAt: new Date() })
        .where(and(eq(briefSchedules.id, run.scheduleId), eq(briefSchedules.tenantId, tenantId)))
    }
  })
  console.log(
    `[briefs] run ${run.id} generated (${generated.evidence.records.length} records, ${recipients.length} recipient(s))`,
  )
}
