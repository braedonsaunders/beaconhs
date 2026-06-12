// Built-in report queries — one function per queryKind. Ported from the old
// apps/worker/src/workers/reports.ts + reports-shared.ts pair so the SAME
// implementation now serves scheduled PDF runs (worker) and the in-app
// viewer / exports (web).
//
// Every function takes a tenant-scoped transaction — callers own the scope
// (web: ctx.db, worker: withTenant). Each returns groups + summary + charts.

import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  correctiveActions,
  documentAcknowledgments,
  documentAssignments,
  documents,
  equipmentItems,
  formResponses,
  formTemplates,
  incidents,
  inspectionRecords,
  lwSessions,
  orgUnits,
  people,
  ppeItems,
  tenantUsers,
  trainingAudienceAssignmentRecords,
  trainingAudienceAssignments,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import {
  formatLabel,
  isoDate,
  pickUuid,
  type ReportChartSpec,
  type ReportGroup,
  type ReportRange,
  type ReportRunResult,
} from './types'

type Filters = Record<string, unknown>

// --- incidents_summary ------------------------------------------------------

export async function queryIncidentsSummary(
  tx: Database,
  filters: Filters,
  range: ReportRange,
): Promise<ReportRunResult> {
  const departmentId = pickUuid(filters.departmentId)
  const siteId = pickUuid(filters.siteOrgUnitId ?? filters.locationId)

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

  const charts: ReportChartSpec[] = []
  if (rows.length > 0) {
    const sevEntries = [...bySeverity.entries()].sort()
    charts.push({
      id: 'severity',
      title: 'Incidents by severity',
      type: 'donut',
      xLabels: sevEntries.map(([s]) => formatLabel(s)),
      series: [{ name: 'Incidents', data: sevEntries.map(([, l]) => l.length) }],
    })
    const statusEntries = [...byStatus.entries()].sort()
    charts.push({
      id: 'status',
      title: 'Incidents by status',
      type: 'bar',
      xLabels: statusEntries.map(([s]) => formatLabel(s)),
      series: [{ name: 'Incidents', data: statusEntries.map(([, c]) => c) }],
    })
  }

  const summary = [
    { label: 'Total', value: rows.length },
    ...[...byStatus.entries()].map(([s, c]) => ({ label: formatLabel(s), value: c })),
  ]
  return { groups, summary, charts, rowCount: rows.length }
}

// --- training_expiring ------------------------------------------------------

export async function queryTrainingExpiring(
  tx: Database,
  _filters: Filters,
  range: ReportRange,
): Promise<ReportRunResult> {
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

  const charts: ReportChartSpec[] = []
  if (rows.length > 0) {
    const top = [...byCourse.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 12)
    charts.push({
      id: 'by-course',
      title: 'Expiring records by course',
      type: 'bar',
      xLabels: top.map(([k]) => k),
      series: [{ name: 'Expiring', data: top.map(([, l]) => l.length) }],
    })
  }

  return {
    groups,
    summary: [
      { label: 'Total expiring', value: rows.length },
      { label: 'Courses affected', value: byCourse.size },
    ],
    charts,
    rowCount: rows.length,
  }
}

// --- corrective_actions_open -------------------------------------------------

export async function queryCorrectiveActionsOpen(
  tx: Database,
  _filters: Filters,
): Promise<ReportRunResult> {
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
    .where(inArray(correctiveActions.status, ['open', 'in_progress', 'pending_verification']))
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

  const charts: ReportChartSpec[] = []
  if (rows.length > 0) {
    const statusEntries = [...byStatus.entries()].sort()
    charts.push({
      id: 'status',
      title: 'Open CAs by status',
      type: 'donut',
      xLabels: statusEntries.map(([s]) => formatLabel(s)),
      series: [{ name: 'Actions', data: statusEntries.map(([, l]) => l.length) }],
    })
    const bySeverity = new Map<string, number>()
    for (const r of rows) bySeverity.set(r.severity, (bySeverity.get(r.severity) ?? 0) + 1)
    const sevEntries = [...bySeverity.entries()].sort()
    charts.push({
      id: 'severity',
      title: 'Open CAs by severity',
      type: 'bar',
      xLabels: sevEntries.map(([s]) => formatLabel(s)),
      series: [{ name: 'Actions', data: sevEntries.map(([, c]) => c) }],
    })
  }

  return {
    groups,
    summary: [{ label: 'Open total', value: rows.length }],
    charts,
    rowCount: rows.length,
  }
}

// --- inspections_completed ---------------------------------------------------

export async function queryInspectionsCompleted(
  tx: Database,
  _filters: Filters,
  range: ReportRange,
): Promise<ReportRunResult> {
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

  const charts: ReportChartSpec[] = []
  if (rows.length > 0) {
    const top = [...byTemplate.values()].sort((a, b) => b.list.length - a.list.length).slice(0, 12)
    charts.push({
      id: 'by-template',
      title: 'Completed inspections by template',
      type: 'bar',
      xLabels: top.map((t) => t.name),
      series: [{ name: 'Completed', data: top.map((t) => t.list.length) }],
    })
  }

  return {
    groups,
    summary: [
      { label: 'Total completed', value: rows.length },
      { label: 'Templates', value: byTemplate.size },
    ],
    charts,
    rowCount: rows.length,
  }
}

// --- documents_overdue_review -------------------------------------------------

export async function queryDocumentsOverdueReview(
  tx: Database,
  _filters: Filters,
): Promise<ReportRunResult> {
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

  const charts: ReportChartSpec[] = []
  if (rows.length > 0) {
    const entries = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length)
    charts.push({
      id: 'by-category',
      title: 'Overdue documents by category',
      type: 'bar',
      xLabels: entries.map(([c]) => formatLabel(c)),
      series: [{ name: 'Documents', data: entries.map(([, l]) => l.length) }],
    })
  }

  return {
    groups,
    summary: [{ label: 'Overdue', value: rows.length }],
    charts,
    rowCount: rows.length,
  }
}

// --- safety_kpi_summary --------------------------------------------------------

export async function querySafetyKpiSummary(
  tx: Database,
  _filters: Filters,
  range: ReportRange,
): Promise<ReportRunResult> {
  const today = isoDate(new Date())

  const incRows = await tx
    .select({ severity: incidents.severity, c: count() })
    .from(incidents)
    .where(and(gte(incidents.occurredAt, range.from), lte(incidents.occurredAt, range.to)))
    .groupBy(incidents.severity)

  const [recordable] = await tx
    .select({ c: count() })
    .from(incidents)
    .where(
      and(
        gte(incidents.occurredAt, range.from),
        lte(incidents.occurredAt, range.to),
        inArray(incidents.severity, ['medical_aid', 'lost_time', 'fatality']),
      ),
    )
  const [lostTime] = await tx
    .select({ c: count() })
    .from(incidents)
    .where(
      and(
        gte(incidents.occurredAt, range.from),
        lte(incidents.occurredAt, range.to),
        eq(incidents.lostTime, true),
      ),
    )

  const [openCa] = await tx
    .select({ c: count() })
    .from(correctiveActions)
    .where(isNull(correctiveActions.closedAt))
  const [overdueCa] = await tx
    .select({ c: count() })
    .from(correctiveActions)
    .where(
      and(
        isNull(correctiveActions.closedAt),
        isNotNull(correctiveActions.dueOn),
        lte(correctiveActions.dueOn, today),
      ),
    )

  const [insp] = await tx
    .select({ c: count() })
    .from(inspectionRecords)
    .where(
      and(
        gte(inspectionRecords.occurredAt, range.from),
        lte(inspectionRecords.occurredAt, range.to),
        inArray(inspectionRecords.status, ['submitted', 'closed']),
      ),
    )

  const trainingComp = await tx
    .select({ status: trainingAudienceAssignmentRecords.status, c: count() })
    .from(trainingAudienceAssignmentRecords)
    .groupBy(trainingAudienceAssignmentRecords.status)
  const trainingTotal = trainingComp.reduce((acc, r) => acc + Number(r.c), 0)
  const trainingCompleted = trainingComp
    .filter((r) => r.status === 'completed')
    .reduce((acc, r) => acc + Number(r.c), 0)
  const trainingPct =
    trainingTotal === 0 ? null : Math.round((trainingCompleted / trainingTotal) * 100)

  const groups: ReportGroup[] = []
  groups.push({
    title: 'Incident severity breakdown',
    subtitle: range.label,
    columns: ['Severity', 'Count'],
    rows: incRows.length === 0 ? [] : incRows.map((r) => [formatLabel(r.severity), Number(r.c)]),
    isEmpty: incRows.length === 0,
  })
  groups.push({
    title: 'Headline KPIs',
    subtitle: `As of ${today}`,
    columns: ['KPI', 'Value'],
    rows: [
      ['Recordable incidents in range', Number(recordable?.c ?? 0)],
      ['Lost-time incidents in range', Number(lostTime?.c ?? 0)],
      ['Inspections completed in range', Number(insp?.c ?? 0)],
      ['Open corrective actions', Number(openCa?.c ?? 0)],
      ['Overdue corrective actions', Number(overdueCa?.c ?? 0)],
      [
        'Training compliance',
        trainingPct === null ? '—' : `${trainingPct}% (${trainingCompleted}/${trainingTotal})`,
      ],
    ],
  })

  const charts: ReportChartSpec[] = []
  if (incRows.length > 0) {
    charts.push({
      id: 'severity',
      title: 'Incidents by severity',
      type: 'donut',
      xLabels: incRows.map((r) => formatLabel(r.severity)),
      series: [{ name: 'Incidents', data: incRows.map((r) => Number(r.c)) }],
    })
  }

  const totalIncidents = incRows.reduce((acc, r) => acc + Number(r.c), 0)
  return {
    groups,
    summary: [
      { label: 'Incidents', value: totalIncidents },
      { label: 'Open CAs', value: Number(openCa?.c ?? 0) },
      { label: 'Overdue CAs', value: Number(overdueCa?.c ?? 0) },
      { label: 'Inspections', value: Number(insp?.c ?? 0) },
    ],
    charts,
    rowCount: totalIncidents,
  }
}

// --- site_scorecard -------------------------------------------------------------

export async function querySiteScorecard(
  tx: Database,
  _filters: Filters,
  range: ReportRange,
): Promise<ReportRunResult> {
  const incPerSite = await tx
    .select({ siteId: incidents.siteOrgUnitId, siteName: orgUnits.name, c: count() })
    .from(incidents)
    .leftJoin(orgUnits, eq(orgUnits.id, incidents.siteOrgUnitId))
    .where(and(gte(incidents.occurredAt, range.from), lte(incidents.occurredAt, range.to)))
    .groupBy(incidents.siteOrgUnitId, orgUnits.name)

  const caPerSite = await tx
    .select({ siteId: correctiveActions.siteOrgUnitId, siteName: orgUnits.name, c: count() })
    .from(correctiveActions)
    .leftJoin(orgUnits, eq(orgUnits.id, correctiveActions.siteOrgUnitId))
    .where(isNull(correctiveActions.closedAt))
    .groupBy(correctiveActions.siteOrgUnitId, orgUnits.name)

  const inspPerSite = await tx
    .select({ siteId: inspectionRecords.siteOrgUnitId, siteName: orgUnits.name, c: count() })
    .from(inspectionRecords)
    .leftJoin(orgUnits, eq(orgUnits.id, inspectionRecords.siteOrgUnitId))
    .where(
      and(
        gte(inspectionRecords.occurredAt, range.from),
        lte(inspectionRecords.occurredAt, range.to),
        inArray(inspectionRecords.status, ['submitted', 'closed']),
      ),
    )
    .groupBy(inspectionRecords.siteOrgUnitId, orgUnits.name)

  type Row = {
    siteId: string | null
    siteName: string
    incidents: number
    openCAs: number
    inspections: number
  }

  const bySite = new Map<string, Row>()
  const upsert = (siteId: string | null, siteName: string | null): Row => {
    const k = siteId ?? '__null'
    const row = bySite.get(k) ?? {
      siteId,
      siteName: siteName ?? '(no site)',
      incidents: 0,
      openCAs: 0,
      inspections: 0,
    }
    bySite.set(k, row)
    return row
  }
  for (const r of incPerSite) upsert(r.siteId, r.siteName).incidents = Number(r.c)
  for (const r of caPerSite) upsert(r.siteId, r.siteName).openCAs = Number(r.c)
  for (const r of inspPerSite) upsert(r.siteId, r.siteName).inspections = Number(r.c)

  const rows = [...bySite.values()].sort((a, b) => b.incidents - a.incidents)

  const groups: ReportGroup[] = [
    {
      title: 'Per-site activity',
      subtitle: range.label,
      columns: ['Site', 'Incidents', 'Open CAs', 'Inspections'],
      rows: rows.map((r) => [r.siteName, r.incidents, r.openCAs, r.inspections]),
      isEmpty: rows.length === 0,
    },
  ]

  const charts: ReportChartSpec[] = []
  if (rows.length > 0) {
    const top = rows.slice(0, 12)
    charts.push({
      id: 'per-site',
      title: 'Activity by site',
      type: 'bar',
      xLabels: top.map((r) => r.siteName),
      series: [
        { name: 'Incidents', data: top.map((r) => r.incidents) },
        { name: 'Open CAs', data: top.map((r) => r.openCAs) },
        { name: 'Inspections', data: top.map((r) => r.inspections) },
      ],
    })
  }

  return {
    groups,
    summary: [
      { label: 'Sites with activity', value: rows.length },
      { label: 'Total incidents', value: rows.reduce((acc, r) => acc + r.incidents, 0) },
    ],
    charts,
    rowCount: rows.length,
  }
}

// --- overdue_rollup ---------------------------------------------------------------

export async function queryOverdueRollup(
  tx: Database,
  _filters: Filters,
): Promise<ReportRunResult> {
  const today = isoDate(new Date())

  const caRows = await tx
    .select({
      reference: correctiveActions.reference,
      title: correctiveActions.title,
      dueOn: correctiveActions.dueOn,
      severity: correctiveActions.severity,
    })
    .from(correctiveActions)
    .where(
      and(
        isNull(correctiveActions.closedAt),
        isNotNull(correctiveActions.dueOn),
        lte(correctiveActions.dueOn, today),
      ),
    )
    .orderBy(asc(correctiveActions.dueOn))

  const trgRows = await tx
    .select({
      person: sql<string>`(${people.lastName} || ', ' || ${people.firstName})`,
      course: trainingCourses.name,
      expiresOn: trainingRecords.expiresOn,
    })
    .from(trainingRecords)
    .innerJoin(people, eq(people.id, trainingRecords.personId))
    .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
    .where(and(isNotNull(trainingRecords.expiresOn), lte(trainingRecords.expiresOn, today)))
    .orderBy(asc(trainingRecords.expiresOn))

  const docRows = await tx
    .select({ key: documents.key, title: documents.title, nextReviewOn: documents.nextReviewOn })
    .from(documents)
    .where(
      and(
        isNotNull(documents.nextReviewOn),
        lte(documents.nextReviewOn, today),
        eq(documents.status, 'published'),
      ),
    )
    .orderBy(asc(documents.nextReviewOn))

  const eqRows = await tx
    .select({
      asset: equipmentItems.assetTag,
      name: equipmentItems.name,
      nextDue: equipmentItems.nextAnnualInspectionDue,
    })
    .from(equipmentItems)
    .where(
      and(
        eq(equipmentItems.requiresAnnualInspection, true),
        isNotNull(equipmentItems.nextAnnualInspectionDue),
        lte(equipmentItems.nextAnnualInspectionDue, today),
      ),
    )
    .orderBy(asc(equipmentItems.nextAnnualInspectionDue))

  const ppeRows = await tx
    .select({
      serial: ppeItems.serialNumber,
      size: ppeItems.size,
      nextDue: ppeItems.nextAnnualInspectionDue,
    })
    .from(ppeItems)
    .where(
      and(
        isNotNull(ppeItems.nextAnnualInspectionDue),
        lte(ppeItems.nextAnnualInspectionDue, today),
      ),
    )
    .orderBy(asc(ppeItems.nextAnnualInspectionDue))

  const groups: ReportGroup[] = [
    {
      title: 'Overdue corrective actions',
      subtitle: `${caRows.length} item(s)`,
      columns: ['Ref', 'Title', 'Severity', 'Due'],
      rows: caRows.map((r) => [r.reference, r.title, formatLabel(r.severity), r.dueOn]),
      isEmpty: caRows.length === 0,
    },
    {
      title: 'Expired training records',
      subtitle: `${trgRows.length} item(s)`,
      columns: ['Person', 'Course', 'Expired on'],
      rows: trgRows.map((r) => [r.person, r.course, r.expiresOn]),
      isEmpty: trgRows.length === 0,
    },
    {
      title: 'Documents past review',
      subtitle: `${docRows.length} item(s)`,
      columns: ['Key', 'Title', 'Review was due'],
      rows: docRows.map((r) => [r.key, r.title, r.nextReviewOn]),
      isEmpty: docRows.length === 0,
    },
    {
      title: 'Equipment annual inspections overdue',
      subtitle: `${eqRows.length} item(s)`,
      columns: ['Asset tag', 'Name', 'Due'],
      rows: eqRows.map((r) => [r.asset, r.name, r.nextDue]),
      isEmpty: eqRows.length === 0,
    },
    {
      title: 'PPE annual inspections overdue',
      subtitle: `${ppeRows.length} item(s)`,
      columns: ['Serial', 'Size', 'Due'],
      rows: ppeRows.map((r) => [r.serial, r.size, r.nextDue]),
      isEmpty: ppeRows.length === 0,
    },
  ]

  const total = caRows.length + trgRows.length + docRows.length + eqRows.length + ppeRows.length

  const charts: ReportChartSpec[] = []
  if (total > 0) {
    charts.push({
      id: 'by-module',
      title: 'Overdue items by module',
      type: 'bar',
      xLabels: ['Corrective actions', 'Training', 'Documents', 'Equipment', 'PPE'],
      series: [
        {
          name: 'Overdue',
          data: [caRows.length, trgRows.length, docRows.length, eqRows.length, ppeRows.length],
        },
      ],
    })
  }

  return {
    groups,
    summary: [
      { label: 'Total overdue items', value: total },
      { label: 'Overdue CAs', value: caRows.length },
      { label: 'Expired training', value: trgRows.length },
      { label: 'Docs past review', value: docRows.length },
      { label: 'Eq. inspections', value: eqRows.length },
      { label: 'PPE inspections', value: ppeRows.length },
    ],
    charts,
    rowCount: total,
  }
}

// --- lone_worker_summary -------------------------------------------------------

export async function queryLoneWorkerSummary(
  tx: Database,
  _filters: Filters,
  range: ReportRange,
): Promise<ReportRunResult> {
  const rows = await tx
    .select({
      id: lwSessions.id,
      startedAt: lwSessions.startedAt,
      endedAt: lwSessions.endedAt,
      status: lwSessions.status,
      task: lwSessions.task,
      intervalMinutes: lwSessions.intervalMinutes,
      siteName: orgUnits.name,
    })
    .from(lwSessions)
    .leftJoin(orgUnits, eq(orgUnits.id, lwSessions.siteOrgUnitId))
    .where(and(gte(lwSessions.startedAt, range.from), lte(lwSessions.startedAt, range.to)))
    .orderBy(desc(lwSessions.startedAt))

  const byStatus = new Map<string, typeof rows>()
  for (const r of rows) {
    const list = byStatus.get(r.status) ?? []
    list.push(r)
    byStatus.set(r.status, list)
  }

  const groups: ReportGroup[] = []
  if (rows.length === 0) {
    groups.push({
      title: 'Lone-worker sessions',
      columns: ['Started', 'Status', 'Task', 'Site', 'Interval'],
      rows: [],
      isEmpty: true,
    })
  } else {
    for (const [status, list] of [...byStatus.entries()].sort()) {
      groups.push({
        title: `Status: ${formatLabel(status)}`,
        subtitle: `${list.length} session(s)`,
        columns: ['Started', 'Ended', 'Task', 'Site', 'Interval (min)'],
        rows: list.map((r) => [
          r.startedAt.toISOString().slice(0, 16).replace('T', ' '),
          r.endedAt ? r.endedAt.toISOString().slice(0, 16).replace('T', ' ') : null,
          r.task ?? null,
          r.siteName ?? null,
          r.intervalMinutes,
        ]),
      })
    }
  }

  const charts: ReportChartSpec[] = []
  if (rows.length > 0) {
    const entries = [...byStatus.entries()].sort()
    charts.push({
      id: 'status',
      title: 'Sessions by status',
      type: 'donut',
      xLabels: entries.map(([s]) => formatLabel(s)),
      series: [{ name: 'Sessions', data: entries.map(([, l]) => l.length) }],
    })
  }

  return {
    groups,
    summary: [
      { label: 'Total sessions', value: rows.length },
      ...[...byStatus.entries()].map(([s, l]) => ({ label: formatLabel(s), value: l.length })),
    ],
    charts,
    rowCount: rows.length,
  }
}

// --- training_compliance_snapshot -----------------------------------------------

export async function queryTrainingComplianceSnapshot(
  tx: Database,
  _filters: Filters,
): Promise<ReportRunResult> {
  const rows = await tx
    .select({
      assignmentId: trainingAudienceAssignments.id,
      name: trainingAudienceAssignments.name,
      status: trainingAudienceAssignmentRecords.status,
      c: count(),
    })
    .from(trainingAudienceAssignmentRecords)
    .innerJoin(
      trainingAudienceAssignments,
      eq(trainingAudienceAssignments.id, trainingAudienceAssignmentRecords.assignmentId),
    )
    .groupBy(
      trainingAudienceAssignments.id,
      trainingAudienceAssignments.name,
      trainingAudienceAssignmentRecords.status,
    )

  type Bucket = {
    name: string
    pending: number
    in_progress: number
    completed: number
    overdue: number
    total: number
    pct: number
  }
  const byAsg = new Map<string, Bucket>()
  for (const r of rows) {
    const b =
      byAsg.get(r.assignmentId) ??
      ({
        name: r.name,
        pending: 0,
        in_progress: 0,
        completed: 0,
        overdue: 0,
        total: 0,
        pct: 0,
      } as Bucket)
    b[r.status as keyof Pick<Bucket, 'pending' | 'in_progress' | 'completed' | 'overdue'>] = Number(
      r.c,
    )
    b.total += Number(r.c)
    byAsg.set(r.assignmentId, b)
  }
  const list = [...byAsg.values()].map((b) => ({
    ...b,
    pct: b.total === 0 ? 0 : Math.round((b.completed / b.total) * 100),
  }))
  list.sort((a, b) => a.pct - b.pct)

  const groups: ReportGroup[] = [
    {
      title: 'Audience assignment compliance',
      columns: ['Assignment', 'Completed', 'In-progress', 'Pending', 'Overdue', 'Total', '%'],
      rows: list.map((b) => [
        b.name,
        b.completed,
        b.in_progress,
        b.pending,
        b.overdue,
        b.total,
        `${b.pct}%`,
      ]),
      isEmpty: list.length === 0,
    },
  ]

  const charts: ReportChartSpec[] = []
  if (list.length > 0) {
    const top = list.slice(0, 12)
    charts.push({
      id: 'per-assignment',
      title: 'Compliance by assignment',
      type: 'bar',
      stacked: true,
      xLabels: top.map((b) => b.name),
      series: [
        { name: 'Completed', data: top.map((b) => b.completed) },
        { name: 'In progress', data: top.map((b) => b.in_progress) },
        { name: 'Pending', data: top.map((b) => b.pending) },
        { name: 'Overdue', data: top.map((b) => b.overdue) },
      ],
    })
  }

  const total = list.reduce((acc, b) => acc + b.total, 0)
  const completed = list.reduce((acc, b) => acc + b.completed, 0)
  const overall = total === 0 ? null : Math.round((completed / total) * 100)
  return {
    groups,
    summary: [
      { label: 'Assignments', value: list.length },
      { label: 'Records', value: total },
      { label: 'Overall %', value: overall === null ? '—' : `${overall}%` },
    ],
    charts,
    rowCount: list.length,
  }
}

// --- document_compliance_snapshot ------------------------------------------------

export async function queryDocumentComplianceSnapshot(
  tx: Database,
  _filters: Filters,
): Promise<ReportRunResult> {
  const rows = await tx
    .select({
      assignmentId: documentAssignments.id,
      title: documentAssignments.title,
      documentId: documentAssignments.documentId,
      documentTitle: documents.title,
      dueOn: documentAssignments.dueOn,
      ackCount: sql<number>`COUNT(DISTINCT ${documentAcknowledgments.personId})::int`,
    })
    .from(documentAssignments)
    .innerJoin(documents, eq(documents.id, documentAssignments.documentId))
    .leftJoin(
      documentAcknowledgments,
      eq(documentAcknowledgments.documentId, documentAssignments.documentId),
    )
    .groupBy(
      documentAssignments.id,
      documentAssignments.title,
      documentAssignments.documentId,
      documents.title,
      documentAssignments.dueOn,
    )
    .orderBy(asc(documentAssignments.dueOn))

  const groups: ReportGroup[] = [
    {
      title: 'Document acknowledgments per assignment',
      columns: ['Assignment', 'Document', 'Due', 'Acknowledged (distinct people)'],
      rows: rows.map((r) => [
        r.title ?? r.documentTitle,
        r.documentTitle,
        r.dueOn,
        Number(r.ackCount),
      ]),
      isEmpty: rows.length === 0,
    },
  ]

  const charts: ReportChartSpec[] = []
  if (rows.length > 0) {
    const top = [...rows].sort((a, b) => Number(b.ackCount) - Number(a.ackCount)).slice(0, 12)
    charts.push({
      id: 'acks',
      title: 'Acknowledgments by assignment',
      type: 'bar',
      xLabels: top.map((r) => r.title ?? r.documentTitle),
      series: [{ name: 'Acknowledged', data: top.map((r) => Number(r.ackCount)) }],
    })
  }

  return {
    groups,
    summary: [
      { label: 'Assignments', value: rows.length },
      { label: 'Total acks', value: rows.reduce((acc, r) => acc + Number(r.ackCount), 0) },
    ],
    charts,
    rowCount: rows.length,
  }
}

// --- incidents_trend_12m -----------------------------------------------------------

export async function queryIncidentsTrend12m(
  tx: Database,
  _filters: Filters,
): Promise<ReportRunResult> {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 11, 1)

  const rows = await tx
    .select({
      month: sql<string>`to_char(${incidents.occurredAt}, 'YYYY-MM')`,
      severity: incidents.severity,
      c: count(),
    })
    .from(incidents)
    .where(gte(incidents.occurredAt, start))
    .groupBy(sql`to_char(${incidents.occurredAt}, 'YYYY-MM')`, incidents.severity)

  // Materialise a 12-month spine so months with no incidents still appear.
  const months: string[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const severities = ['first_aid_only', 'medical_aid', 'lost_time', 'fatality', 'no_injury']
  const grid = new Map<string, Map<string, number>>()
  for (const m of months) {
    const sev = new Map<string, number>()
    for (const s of severities) sev.set(s, 0)
    grid.set(m, sev)
  }
  for (const r of rows) {
    const sev = grid.get(r.month)
    if (!sev) continue
    sev.set(r.severity, Number(r.c))
  }

  const groups: ReportGroup[] = [
    {
      title: 'Incidents by month and severity',
      subtitle: 'Last 12 calendar months',
      columns: ['Month', ...severities.map(formatLabel), 'Total'],
      rows: months.map((m) => {
        const sev = grid.get(m)!
        const total = severities.reduce((acc, s) => acc + (sev.get(s) ?? 0), 0)
        return [m, ...severities.map((s) => sev.get(s) ?? 0), total]
      }),
    },
  ]

  const charts: ReportChartSpec[] = [
    {
      id: 'trend',
      title: 'Monthly incidents by severity',
      type: 'bar',
      stacked: true,
      xLabels: months,
      series: severities.map((s) => ({
        name: formatLabel(s),
        data: months.map((m) => grid.get(m)!.get(s) ?? 0),
      })),
    },
  ]

  const total = rows.reduce((acc, r) => acc + Number(r.c), 0)
  return {
    groups,
    summary: [
      { label: 'Total incidents (12mo)', value: total },
      { label: 'Months covered', value: 12 },
    ],
    charts,
    rowCount: total,
  }
}
