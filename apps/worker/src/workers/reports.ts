// Reports worker.
//
// Consumes the 'reports' BullMQ queue. All query execution lives in
// @beaconhs/reports (shared with the web app's viewer/exports); this module
// only owns the scheduled-run orchestration: load schedule, record the run,
// run the report under the tenant's RLS scope, render + upload the PDF, and
// fan out recipient emails.

import type { Job } from 'bullmq'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { db, withTenant, withSuperAdmin, type Database } from '@beaconhs/db'
import {
  attachments,
  formTemplates,
  people,
  reportRunDeliveries,
  reportRuns,
  reportSchedules,
  roleAssignments,
  roles,
  tenants,
  tenantUsers,
  users,
  type ReportCustomQuery,
  type ReportRunRequestSnapshot,
} from '@beaconhs/db/schema'
import { enqueueEmail, type ReportRunJobData } from '@beaconhs/jobs'
import {
  computeRangeFor,
  refineEntityMapForDocuments,
  resolveReportLayout,
  runReport,
} from '@beaconhs/reports'
import { discoverEntityMapWithScopedApps } from '@beaconhs/analytics/server'
import {
  can,
  canAccessTemplate,
  effectiveRoleAssignments,
  makeTenantContext,
  resolveMembershipAccess,
} from '@beaconhs/tenant'
import { renderReportPdf } from '@beaconhs/forms-pdf'
import { getObject, newAttachmentKey, presignGet, putObject } from '@beaconhs/storage'
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
  const { tenantId, scheduleId, runId } = job.data

  try {
    // The run is created before queue publication and carries an immutable
    // execution snapshot. A later schedule edit cannot change an already
    // queued run's query, recipients, or authorization principal.
    const ctx = await withSuperAdmin(db, async (tx) => {
      const [row] = await tx
        .select({ run: reportRuns, tenant: tenants })
        .from(reportRuns)
        .innerJoin(tenants, eq(tenants.id, reportRuns.tenantId))
        .where(eq(reportRuns.id, runId))
        .limit(1)
      return row ?? null
    })
    if (!ctx) {
      throw new Error(`Report run ${runId} was not found`)
    }
    if (ctx.run.tenantId !== tenantId || ctx.run.scheduleId !== scheduleId) {
      throw new Error('Report job identity does not match its durable run')
    }
    if (ctx.run.status === 'succeeded') {
      console.log(`[reports] run ${runId} already succeeded; acknowledging duplicate delivery`)
      return
    }
    await withSuperAdmin(db, (tx) =>
      tx
        .update(reportRuns)
        .set({ status: 'running', error: null, finishedAt: null })
        .where(eq(reportRuns.id, runId)),
    )

    const snapshot = ctx.run.requestSnapshot
    const range = computeRangeFor(snapshot.definition.queryKind, snapshot.filters)
    let artifact = await loadArtifact(tenantId, ctx.run.pdfAttachmentId, ctx.run.rowCount)

    if (!artifact) {
      const { groups, summary, rowCount } = await withTenant(db, tenantId, async (tx) => {
        const entityMap = await resolveScheduledEntityMap(tx, tenantId, snapshot)
        return runReport(tx, {
          queryKind: snapshot.definition.queryKind,
          filters: snapshot.filters,
          range,
          customQuery: (snapshot.definition.customQuery as ReportCustomQuery | null) ?? null,
          entityMap,
        })
      })
      const pdf = await renderReportPdf({
        tenantName: ctx.tenant.name,
        tenantLogoUrl: ctx.tenant.branding.logoUrl ?? null,
        primaryColor: ctx.tenant.branding.primaryColor ?? null,
        reportName: snapshot.scheduleName || snapshot.definition.name,
        dateRangeLabel: range.label,
        generatedAt: new Date(),
        summary,
        groups,
        layout: resolveReportLayout(snapshot.definition.layout),
      })
      const filename = `${snapshot.definition.slug}-${dateStamp(new Date())}.pdf`
      const r2Key = newAttachmentKey({ tenantId, kind: 'document', filename })
      await putObject({
        key: r2Key,
        body: pdf,
        contentType: 'application/pdf',
        contentDisposition: 'inline',
      })
      const attachmentId = await withTenant(db, tenantId, async (tx) => {
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
        await tx
          .update(reportRuns)
          .set({ pdfAttachmentId: att!.id, rowCount })
          .where(eq(reportRuns.id, runId))
        return att!.id
      })
      artifact = { attachmentId, filename, r2Key, pdf, rowCount }
    }

    // Resolve the immutable recipient snapshot against CURRENT active
    // memberships, then persist one delivery row per normalized address.
    const userEmails = await resolveUserEmails(tenantId, snapshot.recipientUserIds)
    const allEmails = normalizeEmails([...userEmails, ...snapshot.recipientEmails])
    await withTenant(db, tenantId, async (tx) => {
      if (allEmails.length === 0) return
      await tx
        .insert(reportRunDeliveries)
        .values(
          allEmails.map((recipientEmail) => ({
            tenantId,
            runId,
            recipientEmail,
          })),
        )
        .onConflictDoNothing({
          target: [reportRunDeliveries.runId, reportRunDeliveries.recipientEmail],
        })
    })
    const deliveries = await withTenant(db, tenantId, (tx) =>
      tx.select().from(reportRunDeliveries).where(eq(reportRunDeliveries.runId, runId)),
    )

    const subject = `${snapshot.scheduleName || snapshot.definition.name} for ${range.label}`
    const runLink = `${appBaseUrl()}/reports/schedules/${scheduleId}/runs/${runId}`
    const pdfLink = await presignGet({
      key: artifact.r2Key,
      expiresInSeconds: PDF_LINK_EXPIRY_SECONDS,
    })
    const attachPdf = artifact.pdf.length <= MAX_EMAIL_ATTACHMENT_BYTES
    const footnote = attachPdf
      ? 'The PDF is attached to this email and stored on the run record. The download link is valid for 7 days.'
      : 'The PDF was too large to attach — use the download link (valid for 7 days) or the run record in the app.'
    const html = `<p>Your scheduled report <strong>${escapeHtml(snapshot.scheduleName || snapshot.definition.name)}</strong> is ready.</p>
      <p>Date range: ${escapeHtml(range.label)}<br/>Rows: ${artifact.rowCount}</p>
      <p><a href="${escapeHtml(runLink)}">View in app</a> &middot; <a href="${escapeHtml(pdfLink)}">Download PDF</a></p>
      <p style="color:#666;font-size:12px;">${footnote}</p>`
    const text = `Your scheduled report "${snapshot.scheduleName || snapshot.definition.name}" is ready.
Date range: ${range.label}
Rows: ${artifact.rowCount}

View in app: ${runLink}
Download PDF (valid for 7 days): ${pdfLink}`

    const attachments_ = attachPdf
      ? [
          {
            filename: artifact.filename,
            content: artifact.pdf.toString('base64'),
            contentType: 'application/pdf',
          },
        ]
      : undefined
    for (const delivery of deliveries) {
      if (delivery.status !== 'queued') continue
      const emailJobId = `report-email|${delivery.id}`
      await enqueueEmail(
        {
          to: delivery.recipientEmail,
          subject,
          html,
          text,
          attachments: attachments_,
          meta: { tenantId, category: 'report', reportRunDeliveryId: delivery.id },
        },
        { jobId: emailJobId },
      )
      await withTenant(db, tenantId, (tx) =>
        tx
          .update(reportRunDeliveries)
          .set({ status: 'enqueued', emailJobId, error: null })
          .where(
            and(eq(reportRunDeliveries.id, delivery.id), eq(reportRunDeliveries.status, 'queued')),
          ),
      )
    }

    await withSuperAdmin(db, async (tx) => {
      // Email workers set the terminal run status after actual transport
      // success/failure. A no-recipient run can finish as soon as its PDF is
      // persisted.
      if (deliveries.length === 0) {
        await tx
          .update(reportRuns)
          .set({
            status: 'succeeded',
            finishedAt: new Date(),
            pdfAttachmentId: artifact.attachmentId,
            rowCount: artifact.rowCount,
          })
          .where(eq(reportRuns.id, runId))
      }
      await tx
        .update(reportSchedules)
        .set({ lastRunAt: new Date() })
        .where(eq(reportSchedules.id, scheduleId))
    })

    console.log(
      deliveries.length > 0
        ? `[reports] schedule ${scheduleId} generated (run=${runId}, rows=${artifact.rowCount}, ${deliveries.length} delivery job(s) pending)`
        : `[reports] schedule ${scheduleId} succeeded (run=${runId}, rows=${artifact.rowCount}, no recipients)`,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[reports] run failed for schedule ${scheduleId}:`, message)
    try {
      await withSuperAdmin(db, async (tx) => {
        await tx
          .update(reportRuns)
          .set({ status: 'failed', error: message, finishedAt: new Date() })
          .where(eq(reportRuns.id, runId))
      })
    } catch (updateErr) {
      console.error('[reports] also failed to mark run failed:', updateErr)
    }
    throw err
  }
}

async function loadArtifact(
  tenantId: string,
  attachmentId: string | null,
  rowCount: number | null,
): Promise<{
  attachmentId: string
  filename: string
  r2Key: string
  pdf: Buffer
  rowCount: number
} | null> {
  if (!attachmentId || rowCount === null) return null
  const attachment = await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({ id: attachments.id, filename: attachments.filename, r2Key: attachments.r2Key })
      .from(attachments)
      .where(eq(attachments.id, attachmentId))
      .limit(1)
    return row ?? null
  })
  if (!attachment) throw new Error('Report run PDF attachment no longer exists')
  return {
    attachmentId: attachment.id,
    filename: attachment.filename,
    r2Key: attachment.r2Key,
    pdf: await getObject({ key: attachment.r2Key }),
    rowCount,
  }
}

async function resolveScheduledEntityMap(
  tx: Database,
  tenantId: string,
  snapshot: ReportRunRequestSnapshot,
) {
  const [principal] = await tx
    .select({
      id: tenantUsers.id,
      tenantId: tenantUsers.tenantId,
      userId: tenantUsers.userId,
      displayName: tenantUsers.displayName,
      status: tenantUsers.status,
      timezone: users.timezone,
      isSuperAdmin: users.isSuperAdmin,
      personId: people.id,
    })
    .from(tenantUsers)
    .innerJoin(users, eq(users.id, tenantUsers.userId))
    .leftJoin(
      people,
      and(
        eq(people.userId, tenantUsers.userId),
        eq(people.tenantId, tenantUsers.tenantId),
        isNull(people.deletedAt),
      ),
    )
    .where(
      and(
        eq(tenantUsers.id, snapshot.runAsTenantUserId),
        eq(tenantUsers.tenantId, tenantId),
        eq(tenantUsers.status, 'active'),
      ),
    )
    .limit(1)
  if (!principal || principal.status !== 'active') {
    throw new Error('Scheduled report run-as membership is no longer active')
  }

  const resolved = await resolveMembershipAccess(tx, principal.id, snapshot.runAsRoleId)
  if (snapshot.runAsRoleId && resolved.appliedRoleId !== snapshot.runAsRoleId) {
    throw new Error('Scheduled report run-as role is no longer assigned to that member')
  }
  const requestCtx = makeTenantContext(db, {
    userId: principal.userId,
    tenantId,
    isSuperAdmin: principal.isSuperAdmin,
    timezone: principal.timezone,
    membership: { id: principal.id, displayName: principal.displayName ?? principal.userId },
    personId: principal.personId ?? null,
    permissions: resolved.permissions,
    scopes: resolved.scopes,
    activeRoleId: resolved.appliedRoleId,
  })
  if (
    !requestCtx.isSuperAdmin &&
    !can(requestCtx, 'reports.read') &&
    !can(requestCtx, 'reports.builder') &&
    !can(requestCtx, 'reports.schedule')
  ) {
    throw new Error('Scheduled report run-as member no longer has Reports access')
  }

  const [templates, assignedRoles] = await Promise.all([
    tx
      .select({
        id: formTemplates.id,
        name: formTemplates.name,
        status: formTemplates.status,
        allowedRoles: formTemplates.allowedRoles,
        deletedAt: formTemplates.deletedAt,
      })
      .from(formTemplates)
      .where(isNull(formTemplates.deletedAt))
      .orderBy(asc(formTemplates.name)),
    tx
      .select({ roleId: roles.id, key: roles.key })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(eq(roleAssignments.tenantUserId, principal.id)),
  ])
  const roleKeys = new Set(
    effectiveRoleAssignments(resolved.appliedRoleId, assignedRoles).map((role) => role.key),
  )
  const accessibleApps = templates
    .filter((template) => canAccessTemplate(requestCtx, template, roleKeys, 'operate'))
    .map(({ id, name }) => ({ id, name }))
  return refineEntityMapForDocuments(await discoverEntityMapWithScopedApps(tx, accessibleApps))
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

function normalizeEmails(emails: string[]): string[] {
  const normalized = new Set<string>()
  for (const email of emails) {
    const value = email.trim().toLowerCase()
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) normalized.add(value)
  }
  return [...normalized]
}

// --- Small helpers -------------------------------------------------------

function dateStamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, '-').slice(0, 19)
}
