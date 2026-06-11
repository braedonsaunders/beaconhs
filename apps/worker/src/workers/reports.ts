// Reports worker.
//
// Consumes the 'reports' BullMQ queue, runs the relevant query against the
// tenant's data, renders a landscape PDF, attaches it, then enqueues an email
// (with a link back to the in-app run page) to each recipient.

import type { Job } from 'bullmq'
import { and, asc, desc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm'
import { db, withTenant, withSuperAdmin } from '@beaconhs/db'
import {
  attachments,
  correctiveActions,
  documents,
  formResponses,
  formTemplates,
  incidents,
  orgUnits,
  people,
  reportDefinitions,
  reportRuns,
  reportSchedules,
  tenants,
  tenantUsers,
  trainingCourses,
  trainingRecords,
  users,
} from '@beaconhs/db/schema'
import { enqueueEmail, type ReportRunJobData } from '@beaconhs/jobs'
import { renderReportPdf, type ReportGroup } from '@beaconhs/forms-pdf'
import { newAttachmentKey, publicUrl, putObject } from '@beaconhs/storage'

type Range = { from: Date; to: Date; label: string }

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

    // 3. Compute date range and run the appropriate query.
    const range = computeRangeFor(ctx.definition.queryKind, ctx.schedule.filters)
    const { groups, summary, rowCount } = await runReportQuery(
      tenantId,
      ctx.definition.queryKind,
      ctx.schedule.filters,
      range,
      (ctx.definition as unknown as { customQuery?: unknown }).customQuery ?? null,
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

    // 7. Fan out emails.
    const subject = `${ctx.schedule.name || ctx.definition.name} for ${range.label}`
    const appUrl = process.env.PUBLIC_APP_URL ?? process.env.APP_URL ?? 'http://localhost:3000'
    const runLink = `${appUrl}/reports/schedules/${scheduleId}/runs/${runId}`
    const pdfLink = publicUrl(r2Key)
    const html = `<p>Your scheduled report <strong>${escapeHtml(ctx.schedule.name || ctx.definition.name)}</strong> is ready.</p>
      <p>Date range: ${escapeHtml(range.label)}<br/>Rows: ${rowCount}</p>
      <p><a href="${runLink}">View in app</a> &middot; <a href="${pdfLink}">Download PDF</a></p>
      <p style="color:#666;font-size:12px;">PDF is attached to this email and stored on the run record.</p>`
    const text = `Your scheduled report "${ctx.schedule.name || ctx.definition.name}" is ready.
Date range: ${range.label}
Rows: ${rowCount}

View in app: ${runLink}
Download PDF: ${pdfLink}`

    for (const to of allEmails) {
      await enqueueEmail({
        to,
        subject,
        html,
        text,
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

// --- Range helpers --------------------------------------------------------

function computeRangeFor(queryKind: string, filters: Record<string, unknown>): Range {
  const now = new Date()
  const f = filters as { days?: number; rangeDays?: number; lookaheadDays?: number }
  const lookback =
    queryKind === 'training_expiring' || queryKind === 'documents_overdue_review'
      ? null
      : (f.rangeDays ?? f.days ?? defaultLookbackDays(queryKind))
  const lookahead = queryKind === 'training_expiring' ? (f.lookaheadDays ?? f.days ?? 30) : null

  if (lookback !== null) {
    const from = new Date(now.getTime() - lookback * 24 * 3600 * 1000)
    return {
      from,
      to: now,
      label: `${isoDate(from)} → ${isoDate(now)} (last ${lookback} days)`,
    }
  }
  if (lookahead !== null) {
    const to = new Date(now.getTime() + lookahead * 24 * 3600 * 1000)
    return {
      from: now,
      to,
      label: `${isoDate(now)} → ${isoDate(to)} (next ${lookahead} days)`,
    }
  }
  // documents_overdue_review — no real upper bound, just "as of"
  return { from: new Date(0), to: now, label: `As of ${isoDate(now)}` }
}

function defaultLookbackDays(queryKind: string): number {
  switch (queryKind) {
    case 'incidents_summary':
      return 7
    case 'corrective_actions_open':
      return 30 // not used in query, but shown in header
    case 'inspections_completed':
      return 7
    default:
      return 7
  }
}

// --- Query dispatcher -----------------------------------------------------

async function runReportQuery(
  tenantId: string,
  queryKind: string,
  filters: Record<string, unknown>,
  range: Range,
  customQuery?: unknown,
): Promise<{
  groups: ReportGroup[]
  summary: { label: string; value: string | number }[]
  rowCount: number
}> {
  switch (queryKind) {
    case 'incidents_summary':
      return queryIncidentsSummary(tenantId, filters, range)
    case 'training_expiring':
      return queryTrainingExpiring(tenantId, filters, range)
    case 'corrective_actions_open':
      return queryCorrectiveActionsOpen(tenantId, filters)
    case 'inspections_completed':
      return queryInspectionsCompleted(tenantId, filters, range)
    case 'documents_overdue_review':
      return queryDocumentsOverdueReview(tenantId, filters)
    default: {
      // Fall through to the shared-infra dispatcher (cross-module reports +
      // custom-query reports). Lazy-import to avoid circulars.
      const { runSharedReportQuery } = await import('./reports-shared')
      return runSharedReportQuery({ tenantId, queryKind, filters, range, customQuery })
    }
  }
}

// --- Individual queries ---------------------------------------------------

async function queryIncidentsSummary(
  tenantId: string,
  filters: Record<string, unknown>,
  range: Range,
) {
  const departmentId = pickUuid(filters.departmentId)
  const siteId = pickUuid(filters.siteOrgUnitId ?? filters.locationId)

  return await withTenant(db, tenantId, async (tx) => {
    const where = and(
      gte(incidents.occurredAt, range.from),
      lte(incidents.occurredAt, range.to),
      departmentId ? eq(incidents.departmentId, departmentId) : undefined,
      siteId ? eq(incidents.siteOrgUnitId, siteId) : undefined,
    )
    const rows = await tx
      .select({
        id: incidents.id,
        reference: incidents.reference,
        type: incidents.type,
        severity: incidents.severity,
        status: incidents.status,
        title: incidents.title,
        occurredAt: incidents.occurredAt,
        siteName: orgUnits.name,
      })
      .from(incidents)
      .leftJoin(orgUnits, eq(orgUnits.id, incidents.siteOrgUnitId))
      .where(where)
      .orderBy(desc(incidents.occurredAt))

    const bySeverity = new Map<string, typeof rows>()
    const byStatus = new Map<string, number>()
    for (const r of rows) {
      const list = bySeverity.get(r.severity) ?? []
      list.push(r)
      bySeverity.set(r.severity, list)
      byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1)
    }

    const groups: ReportGroup[] = []
    if (rows.length === 0) {
      groups.push({
        title: 'Incidents in range',
        columns: ['Ref', 'Type', 'Severity', 'Status', 'Occurred', 'Site', 'Title'],
        rows: [],
        isEmpty: true,
      })
    } else {
      for (const [sev, list] of [...bySeverity.entries()].sort()) {
        groups.push({
          title: `Severity: ${formatLabel(sev)}`,
          subtitle: `${list.length} incident(s)`,
          columns: ['Ref', 'Type', 'Status', 'Occurred', 'Site', 'Title'],
          rows: list.map((r) => [
            r.reference,
            formatLabel(r.type),
            formatLabel(r.status),
            r.occurredAt.toISOString().slice(0, 10),
            r.siteName ?? null,
            r.title,
          ]),
        })
      }
    }

    const summary = [
      { label: 'Total', value: rows.length },
      ...[...byStatus.entries()].map(([s, c]) => ({ label: formatLabel(s), value: c })),
    ]
    return { groups, summary, rowCount: rows.length }
  })
}

async function queryTrainingExpiring(
  tenantId: string,
  filters: Record<string, unknown>,
  range: Range,
) {
  // range.to bounds how far into the future. Records expiring between today and range.to.
  return await withTenant(db, tenantId, async (tx) => {
    const fromIso = isoDate(range.from)
    const toIso = isoDate(range.to)
    const rows = await tx
      .select({
        recordId: trainingRecords.id,
        expiresOn: trainingRecords.expiresOn,
        completedOn: trainingRecords.completedOn,
        courseCode: trainingCourses.code,
        courseName: trainingCourses.name,
        personFirst: people.firstName,
        personLast: people.lastName,
        personEmployeeNo: people.employeeNo,
      })
      .from(trainingRecords)
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .innerJoin(people, eq(people.id, trainingRecords.personId))
      .where(
        and(
          isNotNull(trainingRecords.expiresOn),
          gte(trainingRecords.expiresOn, fromIso),
          lte(trainingRecords.expiresOn, toIso),
        ),
      )
      .orderBy(asc(trainingRecords.expiresOn))

    const byCourse = new Map<string, typeof rows>()
    for (const r of rows) {
      const k = `${r.courseCode} — ${r.courseName}`
      const list = byCourse.get(k) ?? []
      list.push(r)
      byCourse.set(k, list)
    }

    const groups: ReportGroup[] = []
    if (rows.length === 0) {
      groups.push({
        title: 'Training records expiring',
        columns: ['Course', 'Employee', 'Expires'],
        rows: [],
        isEmpty: true,
      })
    } else {
      for (const [courseLabel, list] of [...byCourse.entries()].sort()) {
        groups.push({
          title: courseLabel,
          subtitle: `${list.length} expiring`,
          columns: ['Employee #', 'Employee', 'Completed', 'Expires'],
          rows: list.map((r) => [
            r.personEmployeeNo ?? null,
            `${r.personLast}, ${r.personFirst}`,
            r.completedOn ?? null,
            r.expiresOn ?? null,
          ]),
        })
      }
    }

    return {
      groups,
      summary: [
        { label: 'Total expiring', value: rows.length },
        { label: 'Courses affected', value: byCourse.size },
      ],
      rowCount: rows.length,
    }
  })
}

async function queryCorrectiveActionsOpen(tenantId: string, filters: Record<string, unknown>) {
  return await withTenant(db, tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: correctiveActions.id,
        reference: correctiveActions.reference,
        title: correctiveActions.title,
        severity: correctiveActions.severity,
        status: correctiveActions.status,
        dueOn: correctiveActions.dueOn,
        ownerId: correctiveActions.ownerTenantUserId,
        ownerName: tenantUsers.displayName,
      })
      .from(correctiveActions)
      .leftJoin(tenantUsers, eq(tenantUsers.id, correctiveActions.ownerTenantUserId))
      .where(
        // 'open' grouping — everything not in a terminal status
        inArray(correctiveActions.status, ['open', 'in_progress', 'pending_verification']),
      )
      .orderBy(asc(correctiveActions.dueOn))

    const byStatus = new Map<string, typeof rows>()
    for (const r of rows) {
      const list = byStatus.get(r.status) ?? []
      list.push(r)
      byStatus.set(r.status, list)
    }

    const groups: ReportGroup[] = []
    if (rows.length === 0) {
      groups.push({
        title: 'Open corrective actions',
        columns: ['Ref', 'Title', 'Severity', 'Owner', 'Due'],
        rows: [],
        isEmpty: true,
      })
    } else {
      for (const [status, list] of [...byStatus.entries()].sort()) {
        groups.push({
          title: `Status: ${formatLabel(status)}`,
          subtitle: `${list.length} action(s)`,
          columns: ['Ref', 'Title', 'Severity', 'Owner', 'Due'],
          rows: list.map((r) => [
            r.reference,
            r.title,
            formatLabel(r.severity),
            r.ownerName ?? '—',
            r.dueOn ?? null,
          ]),
        })
      }
    }

    return {
      groups,
      summary: [{ label: 'Open total', value: rows.length }],
      rowCount: rows.length,
    }
  })
}

async function queryInspectionsCompleted(
  tenantId: string,
  filters: Record<string, unknown>,
  range: Range,
) {
  return await withTenant(db, tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: formResponses.id,
        submittedAt: formResponses.submittedAt,
        status: formResponses.status,
        templateId: formTemplates.id,
        templateName: formTemplates.name,
        siteName: orgUnits.name,
      })
      .from(formResponses)
      .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
      .leftJoin(orgUnits, eq(orgUnits.id, formResponses.siteOrgUnitId))
      .where(
        and(
          eq(formTemplates.category, 'inspection'),
          isNotNull(formResponses.submittedAt),
          gte(formResponses.submittedAt, range.from),
          lte(formResponses.submittedAt, range.to),
        ),
      )
      .orderBy(desc(formResponses.submittedAt))

    const byTemplate = new Map<string, { name: string; list: typeof rows }>()
    for (const r of rows) {
      const e = byTemplate.get(r.templateId) ?? { name: r.templateName, list: [] }
      e.list.push(r)
      byTemplate.set(r.templateId, e)
    }

    const groups: ReportGroup[] = []
    if (rows.length === 0) {
      groups.push({
        title: 'Completed inspections',
        columns: ['Submitted', 'Template', 'Status', 'Site'],
        rows: [],
        isEmpty: true,
      })
    } else {
      for (const [, { name, list }] of [...byTemplate.entries()].sort((a, b) =>
        a[1].name.localeCompare(b[1].name),
      )) {
        groups.push({
          title: name,
          subtitle: `${list.length} completed`,
          columns: ['Submitted', 'Status', 'Site'],
          rows: list.map((r) => [
            r.submittedAt ? r.submittedAt.toISOString().slice(0, 16).replace('T', ' ') : null,
            formatLabel(r.status),
            r.siteName ?? null,
          ]),
        })
      }
    }

    return {
      groups,
      summary: [
        { label: 'Total completed', value: rows.length },
        { label: 'Templates', value: byTemplate.size },
      ],
      rowCount: rows.length,
    }
  })
}

async function queryDocumentsOverdueReview(tenantId: string, filters: Record<string, unknown>) {
  return await withTenant(db, tenantId, async (tx) => {
    const today = isoDate(new Date())
    const rows = await tx
      .select({
        id: documents.id,
        key: documents.key,
        title: documents.title,
        category: documents.category,
        nextReviewOn: documents.nextReviewOn,
        owner: tenantUsers.displayName,
      })
      .from(documents)
      .leftJoin(tenantUsers, eq(tenantUsers.id, documents.ownerTenantUserId))
      .where(
        and(
          isNotNull(documents.nextReviewOn),
          lte(documents.nextReviewOn, today),
          eq(documents.status, 'published'),
        ),
      )
      .orderBy(asc(documents.nextReviewOn))

    const byCategory = new Map<string, typeof rows>()
    for (const r of rows) {
      const k = r.category ?? 'uncategorised'
      const list = byCategory.get(k) ?? []
      list.push(r)
      byCategory.set(k, list)
    }

    const groups: ReportGroup[] = []
    if (rows.length === 0) {
      groups.push({
        title: 'Documents past review date',
        columns: ['Key', 'Title', 'Owner', 'Next review'],
        rows: [],
        isEmpty: true,
      })
    } else {
      for (const [cat, list] of [...byCategory.entries()].sort()) {
        groups.push({
          title: `Category: ${formatLabel(cat)}`,
          subtitle: `${list.length} document(s)`,
          columns: ['Key', 'Title', 'Owner', 'Next review'],
          rows: list.map((r) => [r.key, r.title, r.owner ?? '—', r.nextReviewOn ?? null]),
        })
      }
    }

    return {
      groups,
      summary: [{ label: 'Overdue', value: rows.length }],
      rowCount: rows.length,
    }
  })
}

// --- Recipients ----------------------------------------------------------

async function resolveUserEmails(tenantId: string, userIds: string[]): Promise<string[]> {
  if (!userIds.length) return []
  return await withSuperAdmin(db, async (tx) => {
    const rows = await tx
      .select({ email: users.email })
      .from(users)
      .innerJoin(tenantUsers, eq(tenantUsers.userId, users.id))
      .where(and(eq(tenantUsers.tenantId, tenantId), inArray(users.id, userIds)))
    return rows.map((r) => r.email)
  })
}

// --- Small helpers -------------------------------------------------------

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function dateStamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

function formatLabel(s: string): string {
  return s.replace(/_/g, ' ')
}

function pickUuid(v: unknown): string | null {
  if (typeof v !== 'string') return null
  return /^[0-9a-f-]{36}$/i.test(v) ? v : null
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}
