// Reports worker.
//
// Consumes the 'reports' BullMQ queue. All query execution lives in
// @beaconhs/reports (shared with the web app's viewer/exports); this module
// only owns the scheduled-run orchestration: load schedule, record the run,
// run the report under the tenant's RLS scope, render + upload the PDF, and
// fan out recipient emails.

import type { Job } from 'bullmq'
import { and, eq, inArray } from 'drizzle-orm'
import { db, withTenant, withSuperAdmin } from '@beaconhs/db'
import {
  attachments,
  reportDefinitions,
  reportRuns,
  reportSchedules,
  tenants,
  tenantUsers,
  users,
  type ReportCustomQuery,
} from '@beaconhs/db/schema'
import { enqueueEmail, type ReportRunJobData } from '@beaconhs/jobs'
import { computeRangeFor, resolveReportLayout, runReport } from '@beaconhs/reports'
import { discoverEntityMap } from '@beaconhs/analytics/server'
import { renderReportPdf } from '@beaconhs/forms-pdf'
import { newAttachmentKey, presignGet, putObject } from '@beaconhs/storage'
import { appBaseUrl } from '../lib/app-base-url'
import { escapeHtml } from '../lib/escape-html'

// Attach the rendered PDF to recipient emails up to this size; larger reports
// fall back to the download link only (base64 inflates ~33%, and most mail
// providers reject anything near 25 MB).
const MAX_EMAIL_ATTACHMENT_BYTES = 10 * 1024 * 1024

// Presigned download links in the email stay valid for 7 days — the same
// policy as hazid signed-report bundles. The run record keeps the durable copy.
const PDF_LINK_EXPIRY_SECONDS = 7 * 24 * 3600

export async function processReportRun(job: Job<ReportRunJobData>): Promise<void> {
  const { tenantId, scheduleId } = job.data
  let runId: string | null = null

  try {
    // 1. Load schedule + definition (cross-tenant for definition; with bypass for schedule write).
    const ctx = await withSuperAdmin(db, async (tx) => {
      const [row] = await tx
        .select({ schedule: reportSchedules, definition: reportDefinitions, tenant: tenants })
        .from(reportSchedules)
        .innerJoin(reportDefinitions, eq(reportDefinitions.id, reportSchedules.definitionId))
        .innerJoin(tenants, eq(tenants.id, reportSchedules.tenantId))
        .where(eq(reportSchedules.id, scheduleId))
        .limit(1)
      return row ?? null
    })
    if (!ctx) {
      console.warn(`[reports] schedule ${scheduleId} not found`)
      return
    }

    // 2. Insert the run row.
    runId = await withSuperAdmin(db, async (tx) => {
      const [row] = await tx
        .insert(reportRuns)
        .values({
          tenantId,
          scheduleId,
          status: 'running',
          startedAt: new Date(),
        })
        .returning({ id: reportRuns.id })
      return row!.id
    })

    // 3. Compute date range and run the shared engine under the tenant scope.
    const range = computeRangeFor(ctx.definition.queryKind, ctx.schedule.filters)
    const { groups, summary, rowCount } = await withTenant(db, tenantId, (tx) =>
      runReport(tx, {
        queryKind: ctx.definition.queryKind,
        filters: ctx.schedule.filters,
        range,
        customQuery: (ctx.definition.customQuery as ReportCustomQuery | null) ?? null,
        entityMap: discoverEntityMap(),
      }),
    )

    // 4. Render PDF.
    const pdf = await renderReportPdf({
      tenantName: ctx.tenant.name,
      tenantLogoUrl: ctx.tenant.branding.logoUrl ?? null,
      primaryColor: ctx.tenant.branding.primaryColor ?? null,
      reportName: ctx.schedule.name || ctx.definition.name,
      dateRangeLabel: range.label,
      generatedAt: new Date(),
      summary,
      groups,
      layout: resolveReportLayout(ctx.definition.layout),
    })

    // 5. Upload + create attachment row.
    const filename = `${ctx.definition.slug}-${dateStamp(new Date())}.pdf`
    const r2Key = newAttachmentKey({ tenantId, kind: 'document', filename })
    await putObject({ key: r2Key, body: pdf, contentType: 'application/pdf' })

    const attId = await withTenant(db, tenantId, async (tx) => {
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
      return att!.id
    })

    // 6. Resolve recipients (users + raw emails).
    const userEmails = await resolveUserEmails(tenantId, ctx.schedule.recipientUserIds ?? [])
    const allEmails = Array.from(
      new Set([...userEmails, ...(ctx.schedule.recipientEmails ?? [])].filter(Boolean)),
    )

    // 7. Fan out emails. The PDF rides along as an attachment when it fits;
    // the download link is a bounded presigned URL (never a permanent public
    // object URL — the PDF is full of tenant data).
    const subject = `${ctx.schedule.name || ctx.definition.name} for ${range.label}`
    const runLink = `${appBaseUrl()}/reports/schedules/${scheduleId}/runs/${runId}`
    const pdfLink = await presignGet({ key: r2Key, expiresInSeconds: PDF_LINK_EXPIRY_SECONDS })
    const attachPdf = pdf.length <= MAX_EMAIL_ATTACHMENT_BYTES
    const footnote = attachPdf
      ? 'The PDF is attached to this email and stored on the run record. The download link is valid for 7 days.'
      : 'The PDF was too large to attach — use the download link (valid for 7 days) or the run record in the app.'
    const html = `<p>Your scheduled report <strong>${escapeHtml(ctx.schedule.name || ctx.definition.name)}</strong> is ready.</p>
      <p>Date range: ${escapeHtml(range.label)}<br/>Rows: ${rowCount}</p>
      <p><a href="${escapeHtml(runLink)}">View in app</a> &middot; <a href="${escapeHtml(pdfLink)}">Download PDF</a></p>
      <p style="color:#666;font-size:12px;">${footnote}</p>`
    const text = `Your scheduled report "${ctx.schedule.name || ctx.definition.name}" is ready.
Date range: ${range.label}
Rows: ${rowCount}

View in app: ${runLink}
Download PDF (valid for 7 days): ${pdfLink}`

    const attachments_ = attachPdf
      ? [{ filename, content: pdf.toString('base64'), contentType: 'application/pdf' }]
      : undefined
    for (const to of allEmails) {
      await enqueueEmail({
        to,
        subject,
        html,
        text,
        attachments: attachments_,
        meta: { tenantId, category: 'report' },
      })
    }

    // 8. Update run + schedule.lastRunAt
    await withSuperAdmin(db, async (tx) => {
      await tx
        .update(reportRuns)
        .set({
          status: 'succeeded',
          finishedAt: new Date(),
          pdfAttachmentId: attId,
          rowCount,
        })
        .where(eq(reportRuns.id, runId!))
      await tx
        .update(reportSchedules)
        .set({ lastRunAt: new Date() })
        .where(eq(reportSchedules.id, scheduleId))
    })

    console.log(
      `[reports] schedule ${scheduleId} succeeded (run=${runId}, rows=${rowCount}, ${pdf.length}B)`,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[reports] run failed for schedule ${scheduleId}:`, message)
    if (runId) {
      try {
        await withSuperAdmin(db, async (tx) => {
          await tx
            .update(reportRuns)
            .set({ status: 'failed', error: message, finishedAt: new Date() })
            .where(eq(reportRuns.id, runId!))
        })
      } catch (updateErr) {
        console.error('[reports] also failed to mark run failed:', updateErr)
      }
    }
    throw err
  }
}

// --- Recipients ----------------------------------------------------------

// Only ACTIVE tenant members receive scheduled report emails — suspended or
// removed members left on a schedule's recipient list are dropped (matches the
// escalation and session-overdue recipient resolvers).
async function resolveUserEmails(tenantId: string, userIds: string[]): Promise<string[]> {
  if (!userIds.length) return []
  return await withSuperAdmin(db, async (tx) => {
    const rows = await tx
      .select({ email: users.email })
      .from(users)
      .innerJoin(tenantUsers, eq(tenantUsers.userId, users.id))
      .where(
        and(
          eq(tenantUsers.tenantId, tenantId),
          eq(tenantUsers.status, 'active'),
          inArray(users.id, userIds),
        ),
      )
    return rows.map((r) => r.email)
  })
}

// --- Small helpers -------------------------------------------------------

function dateStamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, '-').slice(0, 19)
}
