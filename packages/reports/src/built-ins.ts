// Built-in report queries — one function per queryKind. Ported from the old
// apps/worker/src/workers/reports.ts + reports-shared.ts pair so the SAME
// implementation now serves scheduled PDF runs (worker) and the in-app
// viewer / exports (web).
//
// Every function takes a tenant-scoped transaction — callers own the scope
// (web: ctx.db, worker: withTenant). Each returns groups + summary.

import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  complianceObligations,
  complianceStatus,
  correctiveActions,
  documentAcknowledgments,
  documentAssignments,
  documentCategories,
  documents,
  equipmentInspectionSchedules,
  equipmentInspectionTypes,
  equipmentItems,
  formResponses,
  formTemplates,
  incidentClassifications,
  incidentInjuries,
  incidentLostTimeEvents,
  incidents,
  inspectionRecords,
  orgUnits,
  people,
  ppeItems,
  tenantUsers,
} from '@beaconhs/db/schema'
import { extractRows } from './custom-query'
import {
  formatLabel,
  isoDate,
  pickUuid,
  type ReportGroup,
  type ReportRange,
  type ReportRunResult,
} from './types'

type Filters = Record<string, unknown>

/** Normalise a raw date value (postgres-js returns `date` columns as strings,
 *  drizzle-mapped ones as Date) to YYYY-MM-DD for display. */
function dayString(v: unknown): string | null {
  if (v === null || typeof v === 'undefined') return null
  if (v instanceof Date) return isoDate(v)
  return String(v).slice(0, 10)
}

/** One row per person × course from the report_training_matrix view — the
 *  LATEST record per active person and course, with soft-deleted rows and
 *  inactive people already excluded. The view reads FORCE-RLS base tables, so
 *  the caller's tenant scope holds. */
type TrainingMatrixRow = {
  employee_no: string | null
  last_name: string
  first_name: string
  course_code: string
  course_name: string
  completed_on: unknown
  expires_on: unknown
}

async function queryTrainingMatrixExpiring(
  tx: Database,
  fromIso: string | null,
  toIso: string,
): Promise<TrainingMatrixRow[]> {
  const result = (await tx.execute(sql`
    SELECT employee_no, last_name, first_name, course_code, course_name, completed_on, expires_on
    FROM report_training_matrix
    WHERE expires_on IS NOT NULL
      ${fromIso ? sql`AND expires_on >= ${fromIso}` : sql``}
      AND expires_on <= ${toIso}
    ORDER BY expires_on ASC
  `)) as unknown
  return extractRows(result) as TrainingMatrixRow[]
}

/** Training-kind obligations in the unified compliance engine. The legacy
 *  training_audience_assignment_records table is decommissioned — the
 *  materialized compliance scoreboard is the live source of truth. */
const TRAINING_COMPLIANCE_KINDS = ['training', 'cert_requirement'] as const

// --- incidents_summary ------------------------------------------------------

export async function queryIncidentsSummary(
  tx: Database,
  filters: Filters,
  range: ReportRange,
): Promise<ReportRunResult> {
  const departmentId = pickUuid(filters.departmentId)
  const siteId = pickUuid(filters.siteOrgUnitId ?? filters.locationId)

  const where = and(
    isNull(incidents.deletedAt),
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
}

// --- training_expiring ------------------------------------------------------

export async function queryTrainingExpiring(
  tx: Database,
  _filters: Filters,
  range: ReportRange,
): Promise<ReportRunResult> {
  // Read the report_training_matrix view: latest record per active person ×
  // course, soft-deleted rows and inactive people already excluded. Superseded
  // certs never surface as "expiring".
  const rows = await queryTrainingMatrixExpiring(tx, isoDate(range.from), isoDate(range.to))

  const byCourse = new Map<string, typeof rows>()
  for (const r of rows) {
    const k = `${r.course_code} — ${r.course_name}`
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
          r.employee_no ?? null,
          `${r.last_name}, ${r.first_name}`,
          dayString(r.completed_on),
          dayString(r.expires_on),
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
    .where(
      and(
        isNull(correctiveActions.deletedAt),
        inArray(correctiveActions.status, ['open', 'in_progress', 'pending_verification']),
      ),
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
        isNull(formResponses.deletedAt),
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
      category: documentCategories.name,
      nextReviewOn: documents.nextReviewOn,
      owner: tenantUsers.displayName,
    })
    .from(documents)
    .leftJoin(documentCategories, eq(documentCategories.id, documents.categoryId))
    .leftJoin(tenantUsers, eq(tenantUsers.id, documents.ownerTenantUserId))
    .where(
      and(
        isNull(documents.deletedAt),
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
    .where(
      and(
        isNull(incidents.deletedAt),
        gte(incidents.occurredAt, range.from),
        lte(incidents.occurredAt, range.to),
      ),
    )
    .groupBy(incidents.severity)

  const [recordable] = await tx
    .select({ c: count() })
    .from(incidents)
    .where(
      and(
        isNull(incidents.deletedAt),
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
        isNull(incidents.deletedAt),
        gte(incidents.occurredAt, range.from),
        lte(incidents.occurredAt, range.to),
        eq(incidents.lostTime, true),
      ),
    )

  const [openCa] = await tx
    .select({ c: count() })
    .from(correctiveActions)
    .where(and(isNull(correctiveActions.deletedAt), isNull(correctiveActions.closedAt)))
  const [overdueCa] = await tx
    .select({ c: count() })
    .from(correctiveActions)
    .where(
      and(
        isNull(correctiveActions.deletedAt),
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
        isNull(inspectionRecords.deletedAt),
        gte(inspectionRecords.occurredAt, range.from),
        lte(inspectionRecords.occurredAt, range.to),
        inArray(inspectionRecords.status, ['submitted', 'closed']),
      ),
    )

  // Training compliance % from the unified engine: materialized compliance_status
  // rows for training-kind obligations. 'completed' (and waived / not_applicable,
  // which are satisfied states) count toward the numerator.
  const trainingComp = await tx
    .select({ status: complianceStatus.status, c: count() })
    .from(complianceStatus)
    .innerJoin(complianceObligations, eq(complianceObligations.id, complianceStatus.obligationId))
    .where(
      and(
        isNull(complianceObligations.deletedAt),
        eq(complianceObligations.status, 'active'),
        inArray(complianceObligations.sourceModule, [...TRAINING_COMPLIANCE_KINDS]),
      ),
    )
    .groupBy(complianceStatus.status)
  const trainingTotal = trainingComp.reduce((acc, r) => acc + Number(r.c), 0)
  const trainingSatisfied = trainingComp
    .filter(
      (r) => r.status === 'completed' || r.status === 'waived' || r.status === 'not_applicable',
    )
    .reduce((acc, r) => acc + Number(r.c), 0)
  const trainingPct =
    trainingTotal === 0 ? null : Math.round((trainingSatisfied / trainingTotal) * 100)

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
        trainingPct === null ? '—' : `${trainingPct}% (${trainingSatisfied}/${trainingTotal})`,
      ],
    ],
  })

  const totalIncidents = incRows.reduce((acc, r) => acc + Number(r.c), 0)
  return {
    groups,
    summary: [
      { label: 'Incidents', value: totalIncidents },
      { label: 'Open CAs', value: Number(openCa?.c ?? 0) },
      { label: 'Overdue CAs', value: Number(overdueCa?.c ?? 0) },
      { label: 'Inspections', value: Number(insp?.c ?? 0) },
    ],
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
    .where(
      and(
        isNull(incidents.deletedAt),
        gte(incidents.occurredAt, range.from),
        lte(incidents.occurredAt, range.to),
      ),
    )
    .groupBy(incidents.siteOrgUnitId, orgUnits.name)

  const caPerSite = await tx
    .select({ siteId: correctiveActions.siteOrgUnitId, siteName: orgUnits.name, c: count() })
    .from(correctiveActions)
    .leftJoin(orgUnits, eq(orgUnits.id, correctiveActions.siteOrgUnitId))
    .where(and(isNull(correctiveActions.deletedAt), isNull(correctiveActions.closedAt)))
    .groupBy(correctiveActions.siteOrgUnitId, orgUnits.name)

  const inspPerSite = await tx
    .select({ siteId: inspectionRecords.siteOrgUnitId, siteName: orgUnits.name, c: count() })
    .from(inspectionRecords)
    .leftJoin(orgUnits, eq(orgUnits.id, inspectionRecords.siteOrgUnitId))
    .where(
      and(
        isNull(inspectionRecords.deletedAt),
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

  return {
    groups,
    summary: [
      { label: 'Sites with activity', value: rows.length },
      { label: 'Total incidents', value: rows.reduce((acc, r) => acc + r.incidents, 0) },
    ],
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
        isNull(correctiveActions.deletedAt),
        isNull(correctiveActions.closedAt),
        isNotNull(correctiveActions.dueOn),
        lte(correctiveActions.dueOn, today),
      ),
    )
    .orderBy(asc(correctiveActions.dueOn))

  // Expired certs from report_training_matrix: latest record per active person ×
  // course, so a renewed cert no longer shows the superseded expired row.
  const trgMatrix = await queryTrainingMatrixExpiring(tx, null, today)
  const trgRows = trgMatrix.map((r) => ({
    person: `${r.last_name}, ${r.first_name}`,
    course: r.course_name,
    expiresOn: dayString(r.expires_on),
  }))

  const docRows = await tx
    .select({ key: documents.key, title: documents.title, nextReviewOn: documents.nextReviewOn })
    .from(documents)
    .where(
      and(
        isNull(documents.deletedAt),
        isNotNull(documents.nextReviewOn),
        lte(documents.nextReviewOn, today),
        eq(documents.status, 'published'),
      ),
    )
    .orderBy(asc(documents.nextReviewOn))

  // Overdue equipment inspections = active per-unit schedules past their
  // next_due_on. Schedule name = the linked inspection type, falling back to
  // the schedule's own label for type-less (due-date-only) cadences.
  const eqRows = await tx
    .select({
      asset: equipmentItems.assetTag,
      name: equipmentItems.name,
      schedule: sql<string>`coalesce(${equipmentInspectionTypes.name}, ${equipmentInspectionSchedules.label}, 'Inspection')`,
      nextDue: equipmentInspectionSchedules.nextDueOn,
    })
    .from(equipmentInspectionSchedules)
    .innerJoin(equipmentItems, eq(equipmentItems.id, equipmentInspectionSchedules.equipmentItemId))
    .leftJoin(
      equipmentInspectionTypes,
      eq(equipmentInspectionTypes.id, equipmentInspectionSchedules.inspectionTypeId),
    )
    .where(
      and(
        eq(equipmentInspectionSchedules.isActive, true),
        lte(equipmentInspectionSchedules.nextDueOn, today),
        isNull(equipmentItems.deletedAt),
      ),
    )
    .orderBy(asc(equipmentInspectionSchedules.nextDueOn))

  const ppeRows = await tx
    .select({
      serial: ppeItems.serialNumber,
      size: ppeItems.size,
      nextDue: ppeItems.nextAnnualInspectionDue,
    })
    .from(ppeItems)
    .where(
      and(
        isNull(ppeItems.deletedAt),
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
      title: 'Equipment inspections overdue',
      subtitle: `${eqRows.length} item(s)`,
      columns: ['Asset tag', 'Name', 'Schedule', 'Due'],
      rows: eqRows.map((r) => [r.asset, r.name, r.schedule, r.nextDue]),
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
      id: formResponses.id,
      startedAt: formResponses.submittedAt,
      endedAt: formResponses.closedAt,
      status: sql<string>`coalesce(${formResponses.monitorStatus}::text, 'unknown')`,
      task: sql<string | null>`${formResponses.data}->>'task'`,
      intervalMinutes: formResponses.checkinIntervalMinutes,
      siteName: orgUnits.name,
    })
    .from(formResponses)
    .leftJoin(orgUnits, eq(orgUnits.id, formResponses.siteOrgUnitId))
    .where(
      and(
        isNull(formResponses.deletedAt),
        isNotNull(formResponses.monitorStatus),
        isNotNull(formResponses.submittedAt),
        gte(formResponses.submittedAt, range.from),
        lte(formResponses.submittedAt, range.to),
      ),
    )
    .orderBy(desc(formResponses.submittedAt))

  const byStatus = new Map<string, typeof rows>()
  for (const r of rows) {
    const list = byStatus.get(r.status) ?? []
    list.push(r)
    byStatus.set(r.status, list)
  }

  const groups: ReportGroup[] = []
  if (rows.length === 0) {
    groups.push({
      title: 'Monitored sessions',
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
          r.startedAt ? r.startedAt.toISOString().slice(0, 16).replace('T', ' ') : null,
          r.endedAt ? r.endedAt.toISOString().slice(0, 16).replace('T', ' ') : null,
          r.task ?? null,
          r.siteName ?? null,
          r.intervalMinutes,
        ]),
      })
    }
  }

  return {
    groups,
    summary: [
      { label: 'Total sessions', value: rows.length },
      ...[...byStatus.entries()].map(([s, l]) => ({ label: formatLabel(s), value: l.length })),
    ],
    rowCount: rows.length,
  }
}

// --- training_compliance_snapshot -----------------------------------------------

export async function queryTrainingComplianceSnapshot(
  tx: Database,
  _filters: Filters,
): Promise<ReportRunResult> {
  // Materialized compliance scoreboard for training-kind obligations, grouped by
  // obligation × status. The legacy training_audience_assignment_records table is
  // decommissioned — compliance_status is the live source of truth.
  const rows = await tx
    .select({
      obligationId: complianceObligations.id,
      name: complianceObligations.title,
      status: complianceStatus.status,
      c: count(),
    })
    .from(complianceStatus)
    .innerJoin(complianceObligations, eq(complianceObligations.id, complianceStatus.obligationId))
    .where(
      and(
        isNull(complianceObligations.deletedAt),
        eq(complianceObligations.status, 'active'),
        inArray(complianceObligations.sourceModule, [...TRAINING_COMPLIANCE_KINDS]),
      ),
    )
    .groupBy(complianceObligations.id, complianceObligations.title, complianceStatus.status)

  type Bucket = {
    name: string
    pending: number
    in_progress: number
    completed: number
    overdue: number
    total: number
    pct: number
  }
  const bucketKeys = ['pending', 'in_progress', 'completed', 'overdue'] as const
  const byAsg = new Map<string, Bucket>()
  for (const r of rows) {
    const b =
      byAsg.get(r.obligationId) ??
      ({
        name: r.name,
        pending: 0,
        in_progress: 0,
        completed: 0,
        overdue: 0,
        total: 0,
        pct: 0,
      } as Bucket)
    // compliance_status has extra states (expiring/waived/not_applicable) beyond
    // the four displayed columns; roll them into the total and treat satisfied
    // states as completed for the coverage %.
    const n = Number(r.c)
    if ((bucketKeys as readonly string[]).includes(r.status)) {
      b[r.status as (typeof bucketKeys)[number]] += n
    } else if (r.status === 'expiring') {
      b.in_progress += n
    } else if (r.status === 'waived' || r.status === 'not_applicable') {
      b.completed += n
    }
    b.total += n
    byAsg.set(r.obligationId, b)
  }
  const list = [...byAsg.values()].map((b) => ({
    ...b,
    pct: b.total === 0 ? 0 : Math.round((b.completed / b.total) * 100),
  }))
  list.sort((a, b) => a.pct - b.pct)

  const groups: ReportGroup[] = [
    {
      title: 'Training obligation compliance',
      columns: ['Obligation', 'Completed', 'In-progress', 'Pending', 'Overdue', 'Total', '%'],
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

  const total = list.reduce((acc, b) => acc + b.total, 0)
  const completed = list.reduce((acc, b) => acc + b.completed, 0)
  const overall = total === 0 ? null : Math.round((completed / total) * 100)
  return {
    groups,
    summary: [
      { label: 'Obligations', value: list.length },
      { label: 'Records', value: total },
      { label: 'Overall %', value: overall === null ? '—' : `${overall}%` },
    ],
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
    .where(and(isNull(documentAssignments.deletedAt), isNull(documents.deletedAt)))
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

  return {
    groups,
    summary: [
      { label: 'Assignments', value: rows.length },
      { label: 'Total acks', value: rows.reduce((acc, r) => acc + Number(r.ackCount), 0) },
    ],
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

  const total = rows.reduce((acc, r) => acc + Number(r.c), 0)
  return {
    groups,
    summary: [
      { label: 'Total incidents (12mo)', value: total },
      { label: 'Months covered', value: 12 },
    ],
    rowCount: total,
  }
}

// --- osha_300_log -----------------------------------------------------------
// OSHA 300/300A-style log: one row per recordable incident in range, with the
// case number, employee, classification, days away / restricted, and outcome.
// "Recordable" = linked classification has isRecordable=1, or (unclassified and
// severity <> no_injury) — the same heuristic the legacy frequency report used.

type Osha300Outcome = 'death' | 'days_away' | 'restricted' | 'medical' | 'first_aid' | 'other'

const OSHA_OUTCOME_LABEL: Record<Osha300Outcome, string> = {
  death: 'Fatality',
  days_away: 'Days away',
  restricted: 'Restricted',
  medical: 'Medical aid',
  first_aid: 'First aid',
  other: 'Other',
}

export async function queryOsha300Log(
  tx: Database,
  _filters: Filters,
  range: ReportRange,
): Promise<ReportRunResult> {
  const incRows = await tx
    .select({ inc: incidents, cls: incidentClassifications })
    .from(incidents)
    .leftJoin(incidentClassifications, eq(incidentClassifications.id, incidents.classificationId))
    .where(
      and(
        gte(incidents.occurredAt, range.from),
        lte(incidents.occurredAt, range.to),
        sql`(
          (${incidentClassifications.isRecordable} = 1)
          or (${incidents.classificationId} is null and ${incidents.severity} <> 'no_injury')
        )`,
      ),
    )
    .orderBy(asc(incidents.occurredAt))

  const incidentIds = incRows.map((r) => r.inc.id)

  const injuryByIncident = new Map<string, { personName: string | null; jobTitle: string | null }>()
  const lostByIncident = new Map<string, { daysAway: number; daysRestricted: number }>()

  if (incidentIds.length > 0) {
    const injRows = await tx
      .select({ inj: incidentInjuries, person: people })
      .from(incidentInjuries)
      .leftJoin(people, eq(people.id, incidentInjuries.personId))
      .where(inArray(incidentInjuries.incidentId, incidentIds))
      .orderBy(asc(incidentInjuries.createdAt))
    for (const r of injRows) {
      if (!injuryByIncident.has(r.inj.incidentId)) {
        const name = r.person ? `${r.person.lastName}, ${r.person.firstName}` : r.inj.personName
        injuryByIncident.set(r.inj.incidentId, {
          personName: name,
          jobTitle: r.person?.jobTitle ?? null,
        })
      }
    }

    const ltRows = await tx
      .select({
        incidentId: incidentLostTimeEvents.incidentId,
        status: incidentLostTimeEvents.status,
        days: sql<number>`coalesce(${incidentLostTimeEvents.validTo}, current_date) - ${incidentLostTimeEvents.validFrom}`.mapWith(
          Number,
        ),
      })
      .from(incidentLostTimeEvents)
      .where(inArray(incidentLostTimeEvents.incidentId, incidentIds))
    for (const r of ltRows) {
      const acc = lostByIncident.get(r.incidentId) ?? { daysAway: 0, daysRestricted: 0 }
      if (r.status === 'off_work') acc.daysAway += Number(r.days)
      else if (r.status === 'restricted_duty') acc.daysRestricted += Number(r.days)
      lostByIncident.set(r.incidentId, acc)
    }
  }

  let daysAwayTotal = 0
  let daysRestrictedTotal = 0
  let fatalities = 0

  const logRows = incRows.map((row) => {
    const inj = injuryByIncident.get(row.inc.id)
    const lt = lostByIncident.get(row.inc.id) ?? { daysAway: 0, daysRestricted: 0 }
    const outcome: Osha300Outcome =
      row.inc.severity === 'fatality'
        ? 'death'
        : lt.daysAway > 0
          ? 'days_away'
          : lt.daysRestricted > 0
            ? 'restricted'
            : row.inc.severity === 'medical_aid'
              ? 'medical'
              : row.inc.severity === 'first_aid_only'
                ? 'first_aid'
                : 'other'
    daysAwayTotal += lt.daysAway
    daysRestrictedTotal += lt.daysRestricted
    if (outcome === 'death') fatalities += 1
    const classification = row.cls
      ? `${row.cls.code ? `${row.cls.code} ` : ''}${row.cls.name}`
      : 'Unclassified'
    return [
      row.inc.reference,
      row.inc.occurredAt.toISOString().slice(0, 10),
      inj?.personName ?? null,
      inj?.jobTitle ?? null,
      classification,
      row.inc.title,
      lt.daysAway,
      lt.daysRestricted,
      OSHA_OUTCOME_LABEL[outcome],
    ]
  })

  const groups: ReportGroup[] = [
    {
      title: 'Recordable incidents',
      subtitle: range.label,
      columns: [
        'Case #',
        'Date',
        'Employee',
        'Job title',
        'Classification',
        'Description',
        'Days away',
        'Days rest.',
        'Outcome',
      ],
      rows: logRows,
      isEmpty: logRows.length === 0,
    },
  ]

  return {
    groups,
    summary: [
      { label: 'Cases', value: logRows.length },
      { label: 'Days away', value: daysAwayTotal },
      { label: 'Days restricted', value: daysRestrictedTotal },
      { label: 'Fatalities', value: fatalities },
    ],
    rowCount: logRows.length,
  }
}
