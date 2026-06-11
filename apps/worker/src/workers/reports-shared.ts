// Cross-module + custom-query report dispatcher.
//
// The original reports.ts dispatcher owns the per-module built-ins
// (incidents_summary, training_expiring, etc). This module owns the
// SHARED-infrastructure reports — anything that spans multiple modules,
// plus the generic 'custom_query' dispatcher used by user-built reports
// from /reports/definitions/new.
//
// Keeping this module separate lets the wave-4 reports module evolve
// without conflicting with per-module agents that extend the original
// dispatcher case by case.

import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import { db, withTenant } from '@beaconhs/db'
import {
  correctiveActions,
  documentAcknowledgments,
  documentAssignments,
  documents,
  equipmentItems,
  incidents,
  inspectionRecords,
  lwSessions,
  orgUnits,
  people,
  ppeItems,
  trainingAudienceAssignmentRecords,
  trainingAudienceAssignments,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import type { ReportGroup } from '@beaconhs/forms-pdf'

type Range = { from: Date; to: Date; label: string }
type RunResult = {
  groups: ReportGroup[]
  summary: { label: string; value: string | number }[]
  rowCount: number
}

export async function runSharedReportQuery(input: {
  tenantId: string
  queryKind: string
  filters: Record<string, unknown>
  range: Range
  customQuery?: unknown
}): Promise<RunResult> {
  const { tenantId, queryKind, filters, range, customQuery } = input
  switch (queryKind) {
    case 'safety_kpi_summary':
      return querySafetyKpiSummary(tenantId, filters, range)
    case 'site_scorecard':
      return querySiteScorecard(tenantId, filters, range)
    case 'overdue_rollup':
      return queryOverdueRollup(tenantId, filters)
    case 'lone_worker_summary':
      return queryLoneWorkerSummary(tenantId, filters, range)
    case 'training_compliance_snapshot':
      return queryTrainingComplianceSnapshot(tenantId, filters)
    case 'document_compliance_snapshot':
      return queryDocumentComplianceSnapshot(tenantId, filters)
    case 'incidents_trend_12m':
      return queryIncidentsTrend12m(tenantId, filters)
    case 'custom_query':
      return runCustomQuery(tenantId, customQuery, range)
    default:
      throw new Error(`Unknown queryKind: ${queryKind}`)
  }
}

// --- Shared helpers -------------------------------------------------------

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function formatLabel(s: string): string {
  return (s ?? '').replace(/_/g, ' ')
}

function pickUuid(v: unknown): string | null {
  if (typeof v !== 'string') return null
  return /^[0-9a-f-]{36}$/i.test(v) ? v : null
}

// --- Safety KPI summary ---------------------------------------------------

async function querySafetyKpiSummary(
  tenantId: string,
  _filters: Record<string, unknown>,
  range: Range,
): Promise<RunResult> {
  const fromIso = isoDate(range.from)
  const today = isoDate(new Date())

  return await withTenant(db, tenantId, async (tx) => {
    // Incidents by severity
    const incRows = await tx
      .select({
        severity: incidents.severity,
        c: count(),
      })
      .from(incidents)
      .where(and(gte(incidents.occurredAt, range.from), lte(incidents.occurredAt, range.to)))
      .groupBy(incidents.severity)

    // Total recordable + lost-time hours/days
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

    // Open CAs
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

    // Inspections completed in range (status=closed/submitted)
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

    // Training compliance %
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
  })
}

// --- Site scorecard -------------------------------------------------------

async function querySiteScorecard(
  tenantId: string,
  _filters: Record<string, unknown>,
  range: Range,
): Promise<RunResult> {
  return await withTenant(db, tenantId, async (tx) => {
    // Incidents per site
    const incPerSite = await tx
      .select({
        siteId: incidents.siteOrgUnitId,
        siteName: orgUnits.name,
        c: count(),
      })
      .from(incidents)
      .leftJoin(orgUnits, eq(orgUnits.id, incidents.siteOrgUnitId))
      .where(and(gte(incidents.occurredAt, range.from), lte(incidents.occurredAt, range.to)))
      .groupBy(incidents.siteOrgUnitId, orgUnits.name)

    // CAs per site (open)
    const caPerSite = await tx
      .select({
        siteId: correctiveActions.siteOrgUnitId,
        siteName: orgUnits.name,
        c: count(),
      })
      .from(correctiveActions)
      .leftJoin(orgUnits, eq(orgUnits.id, correctiveActions.siteOrgUnitId))
      .where(isNull(correctiveActions.closedAt))
      .groupBy(correctiveActions.siteOrgUnitId, orgUnits.name)

    // Inspections per site (closed/submitted)
    const inspPerSite = await tx
      .select({
        siteId: inspectionRecords.siteOrgUnitId,
        siteName: orgUnits.name,
        c: count(),
      })
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
    for (const r of incPerSite) {
      const k = r.siteId ?? '__null'
      bySite.set(k, {
        siteId: r.siteId,
        siteName: r.siteName ?? '(no site)',
        incidents: Number(r.c),
        openCAs: 0,
        inspections: 0,
      })
    }
    for (const r of caPerSite) {
      const k = r.siteId ?? '__null'
      const row = bySite.get(k) ?? {
        siteId: r.siteId,
        siteName: r.siteName ?? '(no site)',
        incidents: 0,
        openCAs: 0,
        inspections: 0,
      }
      row.openCAs = Number(r.c)
      bySite.set(k, row)
    }
    for (const r of inspPerSite) {
      const k = r.siteId ?? '__null'
      const row = bySite.get(k) ?? {
        siteId: r.siteId,
        siteName: r.siteName ?? '(no site)',
        incidents: 0,
        openCAs: 0,
        inspections: 0,
      }
      row.inspections = Number(r.c)
      bySite.set(k, row)
    }

    const rows = [...bySite.values()].sort((a, b) => b.incidents - a.incidents)

    const groups: ReportGroup[] = []
    groups.push({
      title: 'Per-site activity',
      subtitle: range.label,
      columns: ['Site', 'Incidents', 'Open CAs', 'Inspections'],
      rows: rows.map((r) => [r.siteName, r.incidents, r.openCAs, r.inspections]),
      isEmpty: rows.length === 0,
    })

    return {
      groups,
      summary: [
        { label: 'Sites with activity', value: rows.length },
        {
          label: 'Total incidents',
          value: rows.reduce((acc, r) => acc + r.incidents, 0),
        },
      ],
      rowCount: rows.length,
    }
  })
}

// --- Overdue rollup -------------------------------------------------------

async function queryOverdueRollup(
  tenantId: string,
  _filters: Record<string, unknown>,
): Promise<RunResult> {
  const today = isoDate(new Date())
  return await withTenant(db, tenantId, async (tx) => {
    // Overdue CAs
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

    // Overdue training (records expired)
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

    // Overdue documents (next-review past)
    const docRows = await tx
      .select({
        key: documents.key,
        title: documents.title,
        nextReviewOn: documents.nextReviewOn,
      })
      .from(documents)
      .where(
        and(
          isNotNull(documents.nextReviewOn),
          lte(documents.nextReviewOn, today),
          eq(documents.status, 'published'),
        ),
      )
      .orderBy(asc(documents.nextReviewOn))

    // Overdue equipment annual inspections
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

    // Overdue PPE inspections (annual due past)
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

    const groups: ReportGroup[] = []

    groups.push({
      title: 'Overdue corrective actions',
      subtitle: `${caRows.length} item(s)`,
      columns: ['Ref', 'Title', 'Severity', 'Due'],
      rows: caRows.map((r) => [r.reference, r.title, formatLabel(r.severity), r.dueOn]),
      isEmpty: caRows.length === 0,
    })

    groups.push({
      title: 'Expired training records',
      subtitle: `${trgRows.length} item(s)`,
      columns: ['Person', 'Course', 'Expired on'],
      rows: trgRows.map((r) => [r.person, r.course, r.expiresOn]),
      isEmpty: trgRows.length === 0,
    })

    groups.push({
      title: 'Documents past review',
      subtitle: `${docRows.length} item(s)`,
      columns: ['Key', 'Title', 'Review was due'],
      rows: docRows.map((r) => [r.key, r.title, r.nextReviewOn]),
      isEmpty: docRows.length === 0,
    })

    groups.push({
      title: 'Equipment annual inspections overdue',
      subtitle: `${eqRows.length} item(s)`,
      columns: ['Asset tag', 'Name', 'Due'],
      rows: eqRows.map((r) => [r.asset, r.name, r.nextDue]),
      isEmpty: eqRows.length === 0,
    })

    groups.push({
      title: 'PPE annual inspections overdue',
      subtitle: `${ppeRows.length} item(s)`,
      columns: ['Serial', 'Size', 'Due'],
      rows: ppeRows.map((r) => [r.serial, r.size, r.nextDue]),
      isEmpty: ppeRows.length === 0,
    })

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
  })
}

// --- Lone worker summary --------------------------------------------------

async function queryLoneWorkerSummary(
  tenantId: string,
  _filters: Record<string, unknown>,
  range: Range,
): Promise<RunResult> {
  return await withTenant(db, tenantId, async (tx) => {
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

    return {
      groups,
      summary: [
        { label: 'Total sessions', value: rows.length },
        ...[...byStatus.entries()].map(([s, l]) => ({
          label: formatLabel(s),
          value: l.length,
        })),
      ],
      rowCount: rows.length,
    }
  })
}

// --- Training compliance snapshot ----------------------------------------

async function queryTrainingComplianceSnapshot(
  tenantId: string,
  _filters: Record<string, unknown>,
): Promise<RunResult> {
  return await withTenant(db, tenantId, async (tx) => {
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
      b[r.status as keyof Pick<Bucket, 'pending' | 'in_progress' | 'completed' | 'overdue'>] =
        Number(r.c)
      b.total += Number(r.c)
      byAsg.set(r.assignmentId, b)
    }
    const list = [...byAsg.values()].map((b) => ({
      ...b,
      pct: b.total === 0 ? 0 : Math.round((b.completed / b.total) * 100),
    }))
    list.sort((a, b) => a.pct - b.pct)

    const groups: ReportGroup[] = []
    groups.push({
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
    })

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
      rowCount: list.length,
    }
  })
}

// --- Document compliance snapshot ----------------------------------------

async function queryDocumentComplianceSnapshot(
  tenantId: string,
  _filters: Record<string, unknown>,
): Promise<RunResult> {
  return await withTenant(db, tenantId, async (tx) => {
    // Per-assignment: how many people in the audience have acknowledged the
    // current published version. We surface the raw counts and let the reader
    // interpret % (we don't materialise the audience as a separate table).
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

    const groups: ReportGroup[] = []
    groups.push({
      title: 'Document acknowledgments per assignment',
      columns: ['Assignment', 'Document', 'Due', 'Acknowledged (distinct people)'],
      rows: rows.map((r) => [
        r.title ?? r.documentTitle,
        r.documentTitle,
        r.dueOn,
        Number(r.ackCount),
      ]),
      isEmpty: rows.length === 0,
    })

    return {
      groups,
      summary: [
        { label: 'Assignments', value: rows.length },
        {
          label: 'Total acks',
          value: rows.reduce((acc, r) => acc + Number(r.ackCount), 0),
        },
      ],
      rowCount: rows.length,
    }
  })
}

// --- Incidents 12-month trend --------------------------------------------

async function queryIncidentsTrend12m(
  tenantId: string,
  _filters: Record<string, unknown>,
): Promise<RunResult> {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 11, 1)

  return await withTenant(db, tenantId, async (tx) => {
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

    const groups: ReportGroup[] = []
    groups.push({
      title: 'Incidents by month and severity',
      subtitle: 'Last 12 calendar months',
      columns: ['Month', ...severities.map(formatLabel), 'Total'],
      rows: months.map((m) => {
        const sev = grid.get(m)!
        const total = severities.reduce((acc, s) => acc + (sev.get(s) ?? 0), 0)
        return [m, ...severities.map((s) => sev.get(s) ?? 0), total]
      }),
    })

    const total = rows.reduce((acc, r) => acc + Number(r.c), 0)
    return {
      groups,
      summary: [
        { label: 'Total incidents (12mo)', value: total },
        { label: 'Months covered', value: 12 },
      ],
      rowCount: total,
    }
  })
}

// --- Generic custom-query dispatcher -------------------------------------
//
// Custom-built reports created from /reports/definitions/new. The customQuery
// jsonb describes: entity, columns, filters, groupBy, sort, limit. The set of
// supported entities is intentionally small — the runtime is JOIN-free and
// SQL-injection-safe via column whitelists.

const CUSTOM_COLUMN_WHITELIST: Record<string, Record<string, string>> = {
  incidents: {
    reference: 'reference',
    title: 'title',
    severity: 'severity',
    status: 'status',
    type: 'type',
    occurred_at: 'occurred_at',
    site_org_unit_id: 'site_org_unit_id',
    department_id: 'department_id',
    actual_severity: 'actual_severity',
    potential_severity: 'potential_severity',
  },
  corrective_actions: {
    reference: 'reference',
    title: 'title',
    severity: 'severity',
    status: 'status',
    due_on: 'due_on',
    assigned_on: 'assigned_on',
    source: 'source',
    site_org_unit_id: 'site_org_unit_id',
  },
  training_records: {
    person_id: 'person_id',
    course_id: 'course_id',
    completed_on: 'completed_on',
    expires_on: 'expires_on',
    source: 'source',
    score: 'score',
    grade: 'grade',
  },
  skill_assignments: {
    employee_no: 'employee_no',
    last_name: 'last_name',
    first_name: 'first_name',
    trade: 'trade',
    authority: 'authority',
    certification_code: 'certification_code',
    certification_name: 'certification_name',
    granted_on: 'granted_on',
    expires_on: 'expires_on',
    status: 'status',
  },
  inspections: {
    reference: 'reference',
    status: 'status',
    occurred_at: 'occurred_at',
    type_id: 'type_id',
    site_org_unit_id: 'site_org_unit_id',
  },
  documents: {
    key: 'key',
    title: 'title',
    category: 'category',
    status: 'status',
    next_review_on: 'next_review_on',
  },
  equipment: {
    asset_tag: 'asset_tag',
    name: 'name',
    serial_number: 'serial_number',
    status: 'status',
    current_site_org_unit_id: 'current_site_org_unit_id',
    next_annual_inspection_due: 'next_annual_inspection_due',
    next_oil_change_due: 'next_oil_change_due',
  },
  ppe: {
    serial_number: 'serial_number',
    size: 'size',
    status: 'status',
    next_inspection_due: 'next_inspection_due',
    next_annual_inspection_due: 'next_annual_inspection_due',
    expires_on: 'expires_on',
  },
  lone_worker: {
    status: 'status',
    task: 'task',
    started_at: 'started_at',
    expected_end_at: 'expected_end_at',
    interval_minutes: 'interval_minutes',
  },
  form_responses: {
    template_id: 'template_id',
    status: 'status',
    compliance_status: 'compliance_status',
    submitted_at: 'submitted_at',
    site_org_unit_id: 'site_org_unit_id',
  },
  form_participants: {
    person_id: 'person_id',
    template_id: 'template_id',
    category: 'category',
    signed: 'signed',
    occurred_on: 'occurred_on',
  },
}

const CUSTOM_ENTITY_TABLE: Record<string, string> = {
  incidents: 'incidents',
  corrective_actions: 'corrective_actions',
  training_records: 'training_records',
  // Join-baked view (packages/db/src/views.ts) — RLS flows through from base tables.
  skill_assignments: 'report_skill_assignments',
  inspections: 'inspection_records',
  documents: 'documents',
  equipment: 'equipment_items',
  ppe: 'ppe_items',
  lone_worker: 'lw_sessions',
  form_responses: 'form_responses',
  form_participants: 'form_response_participants',
}

async function runCustomQuery(
  tenantId: string,
  customQuery: unknown,
  _range: Range,
): Promise<RunResult> {
  const q = customQuery as {
    entity?: string
    columns?: string[]
    filters?: { column: string; op: string; value?: unknown }[]
    groupBy?: string | null
    sort?: { column: string; direction: 'asc' | 'desc' } | null
    limit?: number | null
  } | null
  if (!q || !q.entity || !CUSTOM_ENTITY_TABLE[q.entity]) {
    throw new Error('Custom query missing or has unknown entity')
  }
  const table = CUSTOM_ENTITY_TABLE[q.entity]
  const whitelist = CUSTOM_COLUMN_WHITELIST[q.entity] ?? {}
  const requestedColumns = (q.columns ?? []).filter((c) => whitelist[c])
  if (requestedColumns.length === 0) {
    throw new Error('Custom query requires at least one valid column')
  }

  // Build a sanitised parameterised raw SQL using whitelisted identifiers
  // and bind parameters for values. We rely on drizzle's `sql` tagged
  // template for binding.

  const where: ReturnType<typeof sql>[] = []
  for (const f of q.filters ?? []) {
    const col = whitelist[f.column]
    if (!col) continue
    const colSql = sql.raw(`"${table}"."${col}"`)
    switch (f.op) {
      case 'eq':
        if (f.value === null || typeof f.value === 'undefined') continue
        where.push(sql`${colSql} = ${f.value}`)
        break
      case 'neq':
        where.push(sql`${colSql} <> ${f.value}`)
        break
      case 'in':
        if (Array.isArray(f.value) && f.value.length) {
          where.push(sql`${colSql} = ANY(${f.value})`)
        }
        break
      case 'not_in':
        if (Array.isArray(f.value) && f.value.length) {
          where.push(sql`${colSql} <> ALL(${f.value})`)
        }
        break
      case 'gte':
        where.push(sql`${colSql} >= ${f.value}`)
        break
      case 'lte':
        where.push(sql`${colSql} <= ${f.value}`)
        break
      case 'is_null':
        where.push(sql`${colSql} IS NULL`)
        break
      case 'is_not_null':
        where.push(sql`${colSql} IS NOT NULL`)
        break
      case 'contains':
        where.push(sql`${colSql} ILIKE ${'%' + String(f.value ?? '') + '%'}`)
        break
      case 'between_days_ago': {
        const days = Number(f.value ?? 30)
        if (!Number.isFinite(days)) continue
        const fromDate = new Date(Date.now() - days * 24 * 3600 * 1000)
        where.push(sql`${colSql} >= ${fromDate}`)
        break
      }
    }
  }

  const sortCol = q.sort?.column && whitelist[q.sort.column] ? whitelist[q.sort.column] : null
  const sortDir = q.sort?.direction === 'asc' ? 'ASC' : 'DESC'
  const limit = Math.min(Math.max(Number(q.limit ?? 1000), 1), 10_000)

  const groupByCol = q.groupBy && whitelist[q.groupBy] ? whitelist[q.groupBy] : null

  return await withTenant(db, tenantId, async (tx) => {
    const selectList = sql.raw(
      requestedColumns.map((c) => `"${table}"."${whitelist[c]}" AS "${c}"`).join(', '),
    )
    const whereSql =
      where.length === 0
        ? sql``
        : sql.join([sql.raw('WHERE'), sql.join(where, sql.raw(' AND '))], sql.raw(' '))
    const orderSql = sortCol ? sql.raw(`ORDER BY "${table}"."${sortCol}" ${sortDir}`) : sql.raw('')

    const queryText = sql.join(
      [
        sql.raw(`SELECT`),
        selectList,
        sql.raw(`FROM "${table}"`),
        whereSql,
        orderSql,
        sql.raw(`LIMIT ${limit}`),
      ],
      sql.raw(' '),
    )

    const result = (await tx.execute(queryText)) as unknown
    const dataRows = extractRows(result)

    const groups: ReportGroup[] = []
    if (groupByCol) {
      const byKey = new Map<string, Record<string, unknown>[]>()
      for (const row of dataRows) {
        const k = String(row[q.groupBy!] ?? '(none)')
        const list = byKey.get(k) ?? []
        list.push(row)
        byKey.set(k, list)
      }
      if (byKey.size === 0) {
        groups.push({
          title: 'Custom report',
          columns: requestedColumns.map(formatLabel),
          rows: [],
          isEmpty: true,
        })
      } else {
        for (const [k, list] of [...byKey.entries()].sort()) {
          groups.push({
            title: `${formatLabel(q.groupBy!)}: ${k}`,
            subtitle: `${list.length} row(s)`,
            columns: requestedColumns.map(formatLabel),
            rows: list.map((row) => requestedColumns.map((c) => formatCustomValue(row[c]))),
          })
        }
      }
    } else {
      groups.push({
        title: 'Results',
        subtitle: `${dataRows.length} row(s)`,
        columns: requestedColumns.map(formatLabel),
        rows: dataRows.map((row) => requestedColumns.map((c) => formatCustomValue(row[c]))),
        isEmpty: dataRows.length === 0,
      })
    }

    return {
      groups,
      summary: [
        { label: 'Rows', value: dataRows.length },
        { label: 'Entity', value: formatLabel(String(q.entity)) },
      ],
      rowCount: dataRows.length,
    }
  })
}

function formatCustomValue(v: unknown): string | number | null {
  if (v === null || typeof v === 'undefined') return null
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ')
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'string') return v
  return String(v)
}

/** Normalise a drizzle/postgres-js execute() result into a row array. */
function extractRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[]
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: Record<string, unknown>[] }).rows
  }
  return []
}
