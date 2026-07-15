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
import { assertReportRunJobData, enqueueEmail, type ReportRunJobData } from '@beaconhs/jobs'
import { resolveLocalePreferences } from '@beaconhs/i18n'
import { createSystemTranslator } from '@beaconhs/i18n/messages'
import {
  computeRangeFor,
  refineEntityMapForDocuments,
  resolveReportLayout,
  runReport,
} from '@beaconhs/reports'
import {
  assertBoundedReportFilters,
  assertReportRecipientLimit,
  normalizeReportRecipientEmails,
  normalizeReportRecipientUserIds,
  REPORT_SCHEDULE_LIMITS,
} from '@beaconhs/reports/schedule-policy'
import { discoverEntityMapWithScopedApps } from '@beaconhs/analytics/server'
import {
  can,
  canAccessTemplate,
  effectiveRoleAssignments,
  makeTenantContext,
  resolveMembershipAccess,
} from '@beaconhs/tenant'
import { renderReportPdf } from '@beaconhs/forms-pdf'
import {
  deleteObject,
  getObject,
  headObject,
  newAttachmentKey,
  presignGet,
  putObject,
  resolveTenantLogoUrl,
} from '@beaconhs/storage'
import { appBaseUrl } from '../lib/app-base-url'
import { escapeHtml } from '../lib/escape-html'

// Attach the rendered PDF to recipient emails up to this size; larger reports
// fall back to the download link only (base64 inflates ~33%, and most mail
// providers reject anything near 25 MB).
const MAX_EMAIL_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_REPORT_PDF_BYTES = 200 * 1024 * 1024

// Presigned download links in the email stay valid for 7 days — the same
// policy as hazid signed-report bundles. The run record keeps the durable copy.
const PDF_LINK_EXPIRY_SECONDS = 7 * 24 * 3600

export async function processReportRun(job: Job<ReportRunJobData>): Promise<void> {
  assertReportRunJobData(job.data)
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
        .where(
          and(
            eq(reportRuns.id, runId),
            eq(reportRuns.tenantId, tenantId),
            eq(reportRuns.scheduleId, scheduleId),
          ),
        )
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
        .set({
          status: 'running',
          error: null,
          finishedAt: null,
          publishLeaseId: null,
          publishClaimedAt: null,
        })
        .where(and(eq(reportRuns.id, runId), eq(reportRuns.tenantId, tenantId))),
    )

    const snapshot = ctx.run.requestSnapshot
    const recipientUserIds = normalizeReportRecipientUserIds(snapshot.recipientUserIds)
    const recipientEmails = normalizeReportRecipientEmails(snapshot.recipientEmails)
    assertReportRecipientLimit(recipientUserIds, recipientEmails)
    assertBoundedReportFilters(snapshot.filters)
    const range = computeRangeFor(snapshot.definition.queryKind, snapshot.filters)
    let artifact = await loadArtifact(tenantId, ctx.run.pdfAttachmentId, ctx.run.rowCount)

    if (!artifact) {
      const { groups, summary, rowCount, locale } = await withTenant(db, tenantId, async (tx) => {
        const { entityMap, locale } = await resolveScheduledEntityMap(tx, tenantId, snapshot)
        const result = await runReport(tx, {
          queryKind: snapshot.definition.queryKind,
          filters: snapshot.filters,
          range,
          customQuery: (snapshot.definition.customQuery as ReportCustomQuery | null) ?? null,
          entityMap,
        })
        return { ...result, locale }
      })
      const pdf = await renderReportPdf({
        tenantName: ctx.tenant.name,
        tenantLogoUrl: await resolveTenantLogoUrl({
          tenantId,
          logoUrl: ctx.tenant.branding.logoUrl,
        }),
        primaryColor: ctx.tenant.branding.primaryColor ?? null,
        reportName: snapshot.scheduleName || snapshot.definition.name,
        dateRangeLabel: range.label,
        generatedAt: new Date(),
        summary,
        groups,
        translate: createSystemTranslator(locale),
        layout: resolveReportLayout(snapshot.definition.layout),
      })
      if (pdf.length === 0 || pdf.length > MAX_REPORT_PDF_BYTES) {
        throw new Error('Scheduled report PDF must be between 1 byte and 200 MiB')
      }
      const filename = `${snapshot.definition.slug}-${dateStamp(new Date())}.pdf`
      const r2Key = newAttachmentKey({ tenantId, kind: 'document', filename })
      await putObject({
        key: r2Key,
        body: pdf,
        contentType: 'application/pdf',
        contentDisposition: 'inline',
      })
      let persistence: { attachmentId: string; rowCount: number; created: boolean }
      try {
        persistence = await withTenant(db, tenantId, async (tx) => {
          const [locked] = await tx
            .select({
              pdfAttachmentId: reportRuns.pdfAttachmentId,
              rowCount: reportRuns.rowCount,
            })
            .from(reportRuns)
            .where(and(eq(reportRuns.id, runId), eq(reportRuns.tenantId, tenantId)))
            .for('update')
            .limit(1)
          if (!locked) throw new Error('Report run was removed before PDF persistence')
          if (locked.pdfAttachmentId) {
            return {
              attachmentId: locked.pdfAttachmentId,
              rowCount: locked.rowCount ?? rowCount,
              created: false,
            }
          }

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
          if (!att) throw new Error('Failed to persist the scheduled report PDF attachment')
          const [updated] = await tx
            .update(reportRuns)
            .set({ pdfAttachmentId: att.id, rowCount })
            .where(
              and(
                eq(reportRuns.id, runId),
                eq(reportRuns.tenantId, tenantId),
                isNull(reportRuns.pdfAttachmentId),
              ),
            )
            .returning({ id: reportRuns.id })
          if (!updated) throw new Error('Report run was removed before PDF persistence')
          return { attachmentId: att.id, rowCount, created: true }
        })
      } catch (error) {
        await deleteObject({ key: r2Key }).catch(() => undefined)
        throw error
      }
      if (persistence.created) {
        artifact = {
          attachmentId: persistence.attachmentId,
          filename,
          r2Key,
          pdf: pdf.length <= MAX_EMAIL_ATTACHMENT_BYTES ? pdf : null,
          rowCount,
        }
      } else {
        await deleteObject({ key: r2Key }).catch((error: unknown) => {
          console.warn('[reports] duplicate render object cleanup failed:', error)
        })
        artifact = await loadArtifact(tenantId, persistence.attachmentId, persistence.rowCount)
        if (!artifact)
          throw new Error('Concurrent report PDF persistence did not produce an artifact')
      }
    }

    // Resolve the immutable recipient snapshot against CURRENT active
    // memberships, then persist one delivery row per normalized address.
    const userEmails = await resolveUserEmails(tenantId, recipientUserIds)
    const allEmails = normalizeReportRecipientEmails([...userEmails, ...recipientEmails])
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
      tx
        .select()
        .from(reportRunDeliveries)
        .where(
          and(eq(reportRunDeliveries.runId, runId), eq(reportRunDeliveries.tenantId, tenantId)),
        )
        .limit(REPORT_SCHEDULE_LIMITS.recipientCount + 1),
    )
    if (deliveries.length > REPORT_SCHEDULE_LIMITS.recipientCount) {
      throw new Error(
        `Report run has more than ${REPORT_SCHEDULE_LIMITS.recipientCount} deliveries`,
      )
    }

    const subject = `${snapshot.scheduleName || snapshot.definition.name} for ${range.label}`
    const runLink = `${appBaseUrl()}/reports/schedules/${scheduleId}/runs/${runId}`
    const pdfLink = await presignGet({
      key: artifact.r2Key,
      expiresInSeconds: PDF_LINK_EXPIRY_SECONDS,
    })
    const attachPdf = artifact.pdf !== null
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
            content: artifact.pdf!.toString('base64'),
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
          .where(and(eq(reportRuns.id, runId), eq(reportRuns.tenantId, tenantId)))
      }
      await tx
        .update(reportSchedules)
        .set({ lastRunAt: new Date() })
        .where(and(eq(reportSchedules.id, scheduleId), eq(reportSchedules.tenantId, tenantId)))
    })

    console.log(
      deliveries.length > 0
        ? `[reports] schedule ${scheduleId} generated (run=${runId}, rows=${artifact.rowCount}, ${deliveries.length} delivery job(s) pending)`
        : `[reports] schedule ${scheduleId} succeeded (run=${runId}, rows=${artifact.rowCount}, no recipients)`,
    )
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err))
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
      .slice(0, 4_000)
    console.error(`[reports] run failed for schedule ${scheduleId}:`, message)
    try {
      await withSuperAdmin(db, async (tx) => {
        await tx
          .update(reportRuns)
          .set({
            status: 'failed',
            error: message,
            finishedAt: new Date(),
            publishLeaseId: null,
            publishClaimedAt: null,
          })
          .where(and(eq(reportRuns.id, runId), eq(reportRuns.tenantId, tenantId)))
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
  pdf: Buffer | null
  rowCount: number
} | null> {
  if (!attachmentId || rowCount === null) return null
  const attachment = await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({
        id: attachments.id,
        filename: attachments.filename,
        r2Key: attachments.r2Key,
        contentType: attachments.contentType,
        sizeBytes: attachments.sizeBytes,
      })
      .from(attachments)
      .where(and(eq(attachments.id, attachmentId), eq(attachments.tenantId, tenantId)))
      .limit(1)
    return row ?? null
  })
  if (!attachment) throw new Error('Report run PDF attachment no longer exists')
  if (attachment.contentType !== 'application/pdf' || attachment.sizeBytes <= 0) {
    throw new Error('Report run PDF attachment metadata is invalid')
  }
  if (attachment.sizeBytes > MAX_REPORT_PDF_BYTES) {
    throw new Error('Report run PDF exceeds the 200 MiB artifact limit')
  }
  const metadata = await headObject({ key: attachment.r2Key })
  if (
    !metadata ||
    metadata.contentType !== 'application/pdf' ||
    metadata.contentLength !== attachment.sizeBytes
  ) {
    throw new Error('Report run PDF object metadata does not match its attachment record')
  }
  const pdf =
    attachment.sizeBytes <= MAX_EMAIL_ATTACHMENT_BYTES
      ? await getObject({ key: attachment.r2Key })
      : null
  if (pdf && pdf.length !== attachment.sizeBytes) {
    throw new Error('Report run PDF object size does not match its attachment record')
  }
  return {
    attachmentId: attachment.id,
    filename: attachment.filename,
    r2Key: attachment.r2Key,
    pdf,
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
      localeOverride: tenantUsers.localeOverride,
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
  const [tenantLocale] = await tx
    .select({
      defaultLanguage: tenants.defaultLanguage,
      enabledLanguages: tenants.enabledLanguages,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
  if (!tenantLocale) throw new Error('Scheduled report tenant no longer exists')
  const localePolicy = resolveLocalePreferences({
    defaultLocale: tenantLocale.defaultLanguage,
    enabledLocales: tenantLocale.enabledLanguages,
    userLocale: principal.localeOverride,
  })

  const resolved = await resolveMembershipAccess(tx, principal.id, snapshot.runAsRoleId)
  if (snapshot.runAsRoleId && resolved.appliedRoleId !== snapshot.runAsRoleId) {
    throw new Error('Scheduled report run-as role is no longer assigned to that member')
  }
  const requestCtx = makeTenantContext(db, {
    userId: principal.userId,
    tenantId,
    isSuperAdmin: principal.isSuperAdmin,
    timezone: principal.timezone,
    ...localePolicy,
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
  return {
    entityMap: refineEntityMapForDocuments(
      await discoverEntityMapWithScopedApps(tx, accessibleApps),
    ),
    locale: localePolicy.locale,
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
