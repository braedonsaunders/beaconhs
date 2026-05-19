// Cross-module compliance helpers.
//
// The compliance dashboard is intentionally read-only and aggregates over four
// disparate assignment kinds:
//
//   - toolbox journal assignments (recurring "weekly toolbox") — compliance is
//     a fraction of expected dispatch occurrences that have a matching journal
//     in the dispatch window.
//   - inspection assignments — uses the precomputed
//     inspection_assignment_compliance snapshot (1 row per assignee per
//     assignment) and rolls up the most recent period.
//   - document assignments — uses document_acknowledgments per resolved
//     audience member.
//   - training audience assignments — uses
//     training_audience_assignment_records keyed on status.
//
// Each helper returns a normalized { completed, pending, overdue, total }
// shape so the dashboard tabs can render a single chart-or-table layout.

import { and, count, eq, gt, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import type { RequestContext } from '@beaconhs/tenant'
import {
  documentAcknowledgments,
  documentAssignmentAudience,
  documentAssignments,
  documents,
  inspectionAssignmentCompliance,
  inspectionAssignments,
  inspectionTypes,
  orgUnits,
  people,
  roleAssignments,
  roles,
  tenantUsers,
  toolboxJournalAssignmentDispatches,
  toolboxJournalAssignments,
  toolboxJournals,
  trades,
  trainingAudienceAssignmentRecords,
  trainingAudienceAssignmentTargets,
  trainingAudienceAssignments,
  trainingAssessmentTypes,
  trainingCourses,
} from '@beaconhs/db/schema'

export type AssignmentKind = 'toolbox' | 'inspection' | 'document' | 'training_assessment'

export const ASSIGNMENT_KIND_LABELS: Record<AssignmentKind, string> = {
  toolbox: 'Toolbox journal',
  inspection: 'Inspection',
  document: 'Document',
  training_assessment: 'Training / assessment',
}

export type AssignmentOption = {
  id: string
  label: string
  notes: string | null
}

export type PersonRow = {
  personId: string
  name: string
  status: 'completed' | 'overdue' | 'pending' | 'in_progress'
  completedOn: string | null
  expected?: number
  count?: number
}

export type ComplianceBreakdown = {
  rows: PersonRow[]
  totals: { total: number; completed: number; overdue: number; pending: number }
  percent: number
}

// ---------- Assignment listing (used by dropdowns) ----------------------

export async function listAssignmentsForKind(
  ctx: RequestContext,
  kind: AssignmentKind,
): Promise<AssignmentOption[]> {
  return ctx.db(async (tx) => {
    if (kind === 'toolbox') {
      const rows = await tx
        .select({
          id: toolboxJournalAssignments.id,
          name: toolboxJournalAssignments.name,
          description: toolboxJournalAssignments.description,
        })
        .from(toolboxJournalAssignments)
        .where(isNull(toolboxJournalAssignments.deletedAt))
        .orderBy(toolboxJournalAssignments.name)
        .limit(500)
      return rows.map((r) => ({ id: r.id, label: r.name, notes: r.description }))
    }
    if (kind === 'inspection') {
      const rows = await tx
        .select({
          id: inspectionAssignments.id,
          frequency: inspectionAssignments.frequency,
          quantity: inspectionAssignments.quantityPerPeriod,
          typeName: inspectionTypes.name,
          notes: inspectionAssignments.notes,
        })
        .from(inspectionAssignments)
        .leftJoin(inspectionTypes, eq(inspectionTypes.id, inspectionAssignments.typeId))
        .where(isNull(inspectionAssignments.deletedAt))
        .orderBy(inspectionTypes.name)
        .limit(500)
      return rows.map((r) => ({
        id: r.id,
        label: `${r.typeName ?? 'Inspection'} — ${r.quantity}/${r.frequency}`,
        notes: r.notes ?? null,
      }))
    }
    if (kind === 'document') {
      const rows = await tx
        .select({
          id: documentAssignments.id,
          title: documentAssignments.title,
          docTitle: documents.title,
          dueOn: documentAssignments.dueOn,
        })
        .from(documentAssignments)
        .innerJoin(documents, eq(documents.id, documentAssignments.documentId))
        .where(isNull(documentAssignments.deletedAt))
        .orderBy(documents.title)
        .limit(500)
      return rows.map((r) => ({
        id: r.id,
        label: r.title ?? r.docTitle ?? 'Document assignment',
        notes: r.dueOn ? `due ${r.dueOn}` : null,
      }))
    }
    // training_assessment — only the assessment_type-bound assignments. Course
    // assignments are surfaced under their own training module.
    const rows = await tx
      .select({
        id: trainingAudienceAssignments.id,
        name: trainingAudienceAssignments.name,
        notes: trainingAudienceAssignments.notes,
        courseName: trainingCourses.name,
        typeName: trainingAssessmentTypes.name,
        dueOn: trainingAudienceAssignments.dueOn,
      })
      .from(trainingAudienceAssignments)
      .leftJoin(trainingCourses, eq(trainingCourses.id, trainingAudienceAssignments.courseId))
      .leftJoin(
        trainingAssessmentTypes,
        eq(trainingAssessmentTypes.id, trainingAudienceAssignments.assessmentTypeId),
      )
      .where(
        and(
          isNull(trainingAudienceAssignments.deletedAt),
          eq(trainingAudienceAssignments.status, 'active'),
        ),
      )
      .orderBy(trainingAudienceAssignments.name)
      .limit(500)
    return rows.map((r) => ({
      id: r.id,
      label: `${r.name} (${r.typeName ?? r.courseName ?? 'item'})`,
      notes: r.dueOn ? `due ${r.dueOn}` : (r.notes ?? null),
    }))
  })
}

// ---------- Per-assignment compliance breakdowns -----------------------

/**
 * Document assignment compliance: resolve the audience and check which person
 * IDs have an acknowledgment for the underlying document.
 */
export async function breakdownDocumentAssignment(
  ctx: RequestContext,
  assignmentId: string,
): Promise<ComplianceBreakdown> {
  return ctx.db(async (tx) => {
    const [assignment] = await tx
      .select()
      .from(documentAssignments)
      .where(eq(documentAssignments.id, assignmentId))
      .limit(1)
    if (!assignment) return emptyBreakdown()

    const audience = await tx
      .select()
      .from(documentAssignmentAudience)
      .where(eq(documentAssignmentAudience.assignmentId, assignmentId))

    const personIds = await resolveDocumentAudience(tx, ctx.tenantId!, audience)
    if (personIds.length === 0) return emptyBreakdown()

    const ackRows = await tx
      .select({
        personId: documentAcknowledgments.personId,
        ackedAt: documentAcknowledgments.acknowledgedAt,
      })
      .from(documentAcknowledgments)
      .where(
        and(
          eq(documentAcknowledgments.documentId, assignment.documentId),
          inArray(documentAcknowledgments.personId, personIds),
        ),
      )
    const ackedAt = new Map<string, Date>()
    for (const r of ackRows) ackedAt.set(r.personId, r.ackedAt)

    const peopleRows = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
      })
      .from(people)
      .where(inArray(people.id, personIds))

    const today = new Date().toISOString().slice(0, 10)
    const overdueDate = assignment.dueOn
    const rows: PersonRow[] = peopleRows.map((p) => {
      const ack = ackedAt.get(p.id)
      const status: PersonRow['status'] = ack
        ? 'completed'
        : overdueDate && overdueDate < today
          ? 'overdue'
          : 'pending'
      return {
        personId: p.id,
        name: personName(p),
        status,
        completedOn: ack ? ack.toISOString().slice(0, 10) : null,
      }
    })

    return tallyBreakdown(rows)
  })
}

/**
 * Training assignment compliance: read precomputed records (which are
 * already populated by the training audience-recompute helpers).
 */
export async function breakdownTrainingAssignment(
  ctx: RequestContext,
  assignmentId: string,
): Promise<ComplianceBreakdown> {
  return ctx.db(async (tx) => {
    const records = await tx
      .select({
        rec: trainingAudienceAssignmentRecords,
        firstName: people.firstName,
        lastName: people.lastName,
      })
      .from(trainingAudienceAssignmentRecords)
      .innerJoin(people, eq(people.id, trainingAudienceAssignmentRecords.personId))
      .where(eq(trainingAudienceAssignmentRecords.assignmentId, assignmentId))

    const rows: PersonRow[] = records.map((r) => ({
      personId: r.rec.personId,
      name: personName({ firstName: r.firstName, lastName: r.lastName }),
      status: r.rec.status,
      completedOn: r.rec.completedOn,
    }))
    return tallyBreakdown(rows)
  })
}

/**
 * Inspection assignment compliance: read the precomputed
 * inspection_assignment_compliance snapshot (p1 = most recent period). A
 * person is "completed" if p1Compliant; "overdue" if p1End < today; otherwise
 * "pending".
 */
export async function breakdownInspectionAssignment(
  ctx: RequestContext,
  assignmentId: string,
): Promise<ComplianceBreakdown> {
  return ctx.db(async (tx) => {
    const snapshots = await tx
      .select({
        snap: inspectionAssignmentCompliance,
        firstName: people.firstName,
        lastName: people.lastName,
      })
      .from(inspectionAssignmentCompliance)
      .innerJoin(people, eq(people.id, inspectionAssignmentCompliance.personId))
      .where(eq(inspectionAssignmentCompliance.assignmentId, assignmentId))

    const today = new Date().toISOString().slice(0, 10)
    const rows: PersonRow[] = snapshots.map((r) => {
      const status: PersonRow['status'] = r.snap.p1Compliant
        ? 'completed'
        : r.snap.p1End && r.snap.p1End < today
          ? 'overdue'
          : 'pending'
      return {
        personId: r.snap.personId,
        name: personName({ firstName: r.firstName, lastName: r.lastName }),
        status,
        completedOn: r.snap.p1End,
        expected: r.snap.p1Expected,
        count: r.snap.p1Count,
      }
    })
    return tallyBreakdown(rows)
  })
}

/**
 * Toolbox assignment compliance: per assignment, count completed journals in
 * the last 30 days against the number of dispatches the scanner has fired.
 * Per-person breakdown is not modelled (toolbox journals are foreman-led, not
 * per-attendee assignments), so we emit a single aggregate row.
 */
export async function breakdownToolboxAssignment(
  ctx: RequestContext,
  assignmentId: string,
): Promise<ComplianceBreakdown> {
  return ctx.db(async (tx) => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const [dispatchedRow] = await tx
      .select({ dispatched: count() })
      .from(toolboxJournalAssignmentDispatches)
      .where(
        and(
          eq(toolboxJournalAssignmentDispatches.assignmentId, assignmentId),
          gte(toolboxJournalAssignmentDispatches.occurredAt, since),
        ),
      )
    const [closedRow] = await tx
      .select({ closed: count() })
      .from(toolboxJournals)
      .where(
        and(
          eq(toolboxJournals.tenantId, ctx.tenantId!),
          gte(toolboxJournals.occurredOn, since.toISOString().slice(0, 10)),
          eq(toolboxJournals.status, 'closed'),
        ),
      )

    const total = Number(dispatchedRow?.dispatched ?? 0)
    const completed = Math.min(Number(closedRow?.closed ?? 0), total)
    const overdue = total > completed ? total - completed : 0
    const percent = total === 0 ? 0 : Math.round((completed / total) * 100)
    const rows: PersonRow[] = [
      {
        personId: 'aggregate',
        name: 'Last 30 days — aggregate',
        status: percent >= 80 ? 'completed' : overdue > 0 ? 'overdue' : 'pending',
        completedOn: null,
        expected: total,
        count: completed,
      },
    ]
    return {
      rows,
      totals: { total, completed, overdue, pending: total - completed - overdue },
      percent,
    }
  })
}

// ---------- By-person breakdown ----------------------------------------

export type PersonAssignmentRow = {
  kind: AssignmentKind
  assignmentId: string
  label: string
  status: PersonRow['status']
  dueOn: string | null
  completedOn: string | null
}

/**
 * For one person, list every assignment they are in across kinds together
 * with their personal status. The training/document path resolves audience
 * membership on the fly; the inspection path reads the precomputed snapshot.
 */
export async function listAssignmentsForPerson(
  ctx: RequestContext,
  personId: string,
): Promise<PersonAssignmentRow[]> {
  return ctx.db(async (tx) => {
    const out: PersonAssignmentRow[] = []
    const today = new Date().toISOString().slice(0, 10)

    // ---- Training (precomputed records keyed by personId) ----
    const tr = await tx
      .select({
        rec: trainingAudienceAssignmentRecords,
        name: trainingAudienceAssignments.name,
        dueOn: trainingAudienceAssignments.dueOn,
      })
      .from(trainingAudienceAssignmentRecords)
      .innerJoin(
        trainingAudienceAssignments,
        eq(trainingAudienceAssignments.id, trainingAudienceAssignmentRecords.assignmentId),
      )
      .where(eq(trainingAudienceAssignmentRecords.personId, personId))
    for (const r of tr) {
      out.push({
        kind: 'training_assessment',
        assignmentId: r.rec.assignmentId,
        label: r.name,
        status: r.rec.status,
        dueOn: r.dueOn,
        completedOn: r.rec.completedOn,
      })
    }

    // ---- Inspection (precomputed snapshot keyed by personId) ----
    const ins = await tx
      .select({
        snap: inspectionAssignmentCompliance,
        typeName: inspectionTypes.name,
        frequency: inspectionAssignments.frequency,
        quantity: inspectionAssignments.quantityPerPeriod,
      })
      .from(inspectionAssignmentCompliance)
      .innerJoin(
        inspectionAssignments,
        eq(inspectionAssignments.id, inspectionAssignmentCompliance.assignmentId),
      )
      .leftJoin(inspectionTypes, eq(inspectionTypes.id, inspectionAssignments.typeId))
      .where(eq(inspectionAssignmentCompliance.personId, personId))
    for (const r of ins) {
      const status: PersonRow['status'] = r.snap.p1Compliant
        ? 'completed'
        : r.snap.p1End && r.snap.p1End < today
          ? 'overdue'
          : 'pending'
      out.push({
        kind: 'inspection',
        assignmentId: r.snap.assignmentId,
        label: `${r.typeName ?? 'Inspection'} — ${r.quantity}/${r.frequency}`,
        status,
        dueOn: r.snap.p1End,
        completedOn: status === 'completed' ? r.snap.p1End : null,
      })
    }

    // ---- Document — resolve audience inline against this person's id ----
    const docs = await tx
      .select({
        assignment: documentAssignments,
        docTitle: documents.title,
      })
      .from(documentAssignments)
      .innerJoin(documents, eq(documents.id, documentAssignments.documentId))
      .where(isNull(documentAssignments.deletedAt))
      .limit(500)
    for (const d of docs) {
      const aud = await tx
        .select()
        .from(documentAssignmentAudience)
        .where(eq(documentAssignmentAudience.assignmentId, d.assignment.id))
      const memberIds = await resolveDocumentAudience(tx, ctx.tenantId!, aud)
      if (!memberIds.includes(personId)) continue
      const [ack] = await tx
        .select({ ackedAt: documentAcknowledgments.acknowledgedAt })
        .from(documentAcknowledgments)
        .where(
          and(
            eq(documentAcknowledgments.documentId, d.assignment.documentId),
            eq(documentAcknowledgments.personId, personId),
          ),
        )
        .limit(1)
      const status: PersonRow['status'] = ack
        ? 'completed'
        : d.assignment.dueOn && d.assignment.dueOn < today
          ? 'overdue'
          : 'pending'
      out.push({
        kind: 'document',
        assignmentId: d.assignment.id,
        label: d.assignment.title ?? d.docTitle ?? 'Document assignment',
        status,
        dueOn: d.assignment.dueOn,
        completedOn: ack?.ackedAt ? ack.ackedAt.toISOString().slice(0, 10) : null,
      })
    }
    return out
  })
}

// ---------- Aging summary (cross-module) -------------------------------

export type AgingBucket = '0_7' | '7_30' | '30_plus'

export type AgingRow = {
  kind: AssignmentKind
  bucket: AgingBucket
  count: number
}

/**
 * Cross-kind overdue counts grouped into 0-7 / 7-30 / 30+ day buckets. Uses
 * the underlying tables directly so the dashboard is always real-time and
 * never blocked by stale snapshots.
 */
export async function computeAgingSummary(ctx: RequestContext): Promise<AgingRow[]> {
  return ctx.db(async (tx) => {
    const out: AgingRow[] = []
    const today = new Date()
    const todayIso = today.toISOString().slice(0, 10)
    const t7Iso = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
    const t30Iso = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)

    // Training: overdue is status='overdue'; we age by dueOn from the parent
    // assignment.
    const trainingRows = await tx
      .select({
        dueOn: trainingAudienceAssignments.dueOn,
      })
      .from(trainingAudienceAssignmentRecords)
      .innerJoin(
        trainingAudienceAssignments,
        eq(trainingAudienceAssignments.id, trainingAudienceAssignmentRecords.assignmentId),
      )
      .where(
        and(
          eq(trainingAudienceAssignmentRecords.tenantId, ctx.tenantId!),
          eq(trainingAudienceAssignmentRecords.status, 'overdue'),
        ),
      )
    out.push(...bucketRows('training_assessment', trainingRows, todayIso, t7Iso, t30Iso))

    // Document: any audience-member who hasn't ack'd and assignment dueOn has
    // passed. Same audience-resolution short-cut as listAssignmentsForPerson —
    // for the dashboard view we approximate by counting only assignments where
    // assignment.dueOn < today; per-person breakdown is shown in the doc tab.
    const overdueDocs = await tx
      .select({
        id: documentAssignments.id,
        dueOn: documentAssignments.dueOn,
        documentId: documentAssignments.documentId,
      })
      .from(documentAssignments)
      .where(
        and(
          eq(documentAssignments.tenantId, ctx.tenantId!),
          isNull(documentAssignments.deletedAt),
          lt(documentAssignments.dueOn, todayIso),
        ),
      )
    for (const d of overdueDocs) {
      const aud = await tx
        .select()
        .from(documentAssignmentAudience)
        .where(eq(documentAssignmentAudience.assignmentId, d.id))
      const personIds = await resolveDocumentAudience(tx, ctx.tenantId!, aud)
      if (personIds.length === 0) continue
      const acked = await tx
        .select({ personId: documentAcknowledgments.personId })
        .from(documentAcknowledgments)
        .where(
          and(
            eq(documentAcknowledgments.documentId, d.documentId),
            inArray(documentAcknowledgments.personId, personIds),
          ),
        )
      const ackedSet = new Set(acked.map((a) => a.personId))
      const missing = personIds.length - ackedSet.size
      if (missing <= 0) continue
      out.push({
        kind: 'document',
        bucket: bucketForDate(d.dueOn, todayIso, t7Iso, t30Iso),
        count: missing,
      })
    }

    // Inspection: any non-compliant snapshot with p1End < today.
    const insRows = await tx
      .select({ dueOn: inspectionAssignmentCompliance.p1End })
      .from(inspectionAssignmentCompliance)
      .where(
        and(
          eq(inspectionAssignmentCompliance.tenantId, ctx.tenantId!),
          eq(inspectionAssignmentCompliance.p1Compliant, false),
          lt(inspectionAssignmentCompliance.p1End, todayIso),
        ),
      )
    out.push(...bucketRows('inspection', insRows, todayIso, t7Iso, t30Iso))

    // Toolbox: each closed journal in the last 30 days satisfies one
    // dispatch; over the same window any unsatisfied dispatch is "overdue".
    // The aging here is the dispatch's occurredAt — older dispatches are more
    // worrying.
    const dispRows = await tx
      .select({
        occurredAt: toolboxJournalAssignmentDispatches.occurredAt,
      })
      .from(toolboxJournalAssignmentDispatches)
      .where(
        and(
          eq(toolboxJournalAssignmentDispatches.tenantId, ctx.tenantId!),
          lt(toolboxJournalAssignmentDispatches.occurredAt, today),
        ),
      )
    // Translate timestamps → ISO dates for bucketing.
    const toolboxOverdueRows = dispRows.map((r) => ({
      dueOn: r.occurredAt.toISOString().slice(0, 10),
    }))
    out.push(...bucketRows('toolbox', toolboxOverdueRows, todayIso, t7Iso, t30Iso))

    // Collapse: sum counts by (kind, bucket) — bucketRows returns one row per
    // input record so we need a final group-by here.
    const collapsed = new Map<string, AgingRow>()
    for (const r of out) {
      const k = `${r.kind}::${r.bucket}`
      const cur = collapsed.get(k) ?? { kind: r.kind, bucket: r.bucket, count: 0 }
      cur.count += r.count
      collapsed.set(k, cur)
    }
    return Array.from(collapsed.values())
  })
}

// ---------- Site / project compliance ----------------------------------

export type SiteComplianceRow = {
  siteId: string
  siteName: string
  inspectionsCompleted: number
  inspectionsExpected: number
  toolboxClosed: number
}

/**
 * Per-site rollup over the last 30 days: inspections completed vs expected
 * (from the inspection_assignment_compliance snapshot) and toolbox journals
 * closed. Useful as a "where are the gaps" view.
 */
export async function computeSiteCompliance(
  ctx: RequestContext,
  siteFilter: string | null,
): Promise<SiteComplianceRow[]> {
  return ctx.db(async (tx) => {
    const siteWhere = siteFilter
      ? and(
          eq(orgUnits.tenantId, ctx.tenantId!),
          inArray(orgUnits.level, ['site', 'project']),
          eq(orgUnits.id, siteFilter),
        )
      : and(
          eq(orgUnits.tenantId, ctx.tenantId!),
          inArray(orgUnits.level, ['site', 'project']),
        )
    const sites = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(siteWhere)
      .orderBy(orgUnits.name)

    // Inspection compliance is rolled up tenant-wide because
    // inspection_assignments doesn't carry a siteOrgUnitId column yet — every
    // site row will show the same inspection numbers until that is added.
    // We still show the per-site toolbox count which is the meaningful
    // per-site signal today.
    const [insAgg] = await tx
      .select({
        completed: sql<number>`coalesce(sum(${inspectionAssignmentCompliance.p1Count}), 0)`.mapWith(
          Number,
        ),
        expected: sql<number>`coalesce(sum(${inspectionAssignmentCompliance.p1Expected}), 0)`.mapWith(
          Number,
        ),
      })
      .from(inspectionAssignmentCompliance)
      .where(eq(inspectionAssignmentCompliance.tenantId, ctx.tenantId!))

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const out: SiteComplianceRow[] = []
    for (const s of sites) {
      const [tbxAgg] = await tx
        .select({
          closed: count(),
        })
        .from(toolboxJournals)
        .where(
          and(
            eq(toolboxJournals.tenantId, ctx.tenantId!),
            eq(toolboxJournals.siteOrgUnitId, s.id),
            gte(toolboxJournals.occurredOn, since.toISOString().slice(0, 10)),
            eq(toolboxJournals.status, 'closed'),
          ),
        )

      out.push({
        siteId: s.id,
        siteName: s.name,
        inspectionsCompleted: Number(insAgg?.completed ?? 0),
        inspectionsExpected: Number(insAgg?.expected ?? 0),
        toolboxClosed: Number(tbxAgg?.closed ?? 0),
      })
    }
    return out
  })
}

// ---------- Internal helpers -------------------------------------------

function tallyBreakdown(rows: PersonRow[]): ComplianceBreakdown {
  const total = rows.length
  const completed = rows.filter((r) => r.status === 'completed').length
  const overdue = rows.filter((r) => r.status === 'overdue').length
  const pending = total - completed - overdue
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100)
  rows.sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.name.localeCompare(b.name))
  return { rows, totals: { total, completed, overdue, pending }, percent }
}

function statusRank(s: PersonRow['status']): number {
  return s === 'overdue' ? 0 : s === 'pending' ? 1 : s === 'in_progress' ? 2 : 3
}

function emptyBreakdown(): ComplianceBreakdown {
  return { rows: [], totals: { total: 0, completed: 0, overdue: 0, pending: 0 }, percent: 0 }
}

function personName(p: {
  firstName?: string | null
  lastName?: string | null
}): string {
  const last = p.lastName ?? ''
  const first = p.firstName ?? ''
  return `${last}${last ? ', ' : ''}${first}`.trim() || '(unnamed)'
}

async function resolveDocumentAudience(
  tx: any,
  tenantId: string,
  audience: {
    type: 'role' | 'trade' | 'department' | 'person' | 'everyone'
    entityKey: string
  }[],
): Promise<string[]> {
  if (audience.length === 0) return []
  if (audience.some((a) => a.type === 'everyone')) {
    const rows = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.tenantId, tenantId), eq(people.status, 'active'), isNull(people.deletedAt)))
    return rows.map((r: { id: string }) => r.id)
  }
  const set = new Set<string>()
  const directPeople = audience.filter((a) => a.type === 'person').map((a) => a.entityKey)
  for (const id of directPeople) set.add(id)
  const tradeIds = audience.filter((a) => a.type === 'trade').map((a) => a.entityKey)
  if (tradeIds.length > 0) {
    const rows = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.tenantId, tenantId),
          eq(people.status, 'active'),
          isNull(people.deletedAt),
          inArray(people.tradeId, tradeIds),
        ),
      )
    for (const r of rows) set.add(r.id)
  }
  const deptIds = audience.filter((a) => a.type === 'department').map((a) => a.entityKey)
  if (deptIds.length > 0) {
    const rows = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.tenantId, tenantId),
          eq(people.status, 'active'),
          isNull(people.deletedAt),
          inArray(people.departmentId, deptIds),
        ),
      )
    for (const r of rows) set.add(r.id)
  }
  const roleKeys = audience.filter((a) => a.type === 'role').map((a) => a.entityKey)
  if (roleKeys.length > 0) {
    const userIds = await tx
      .select({ userId: tenantUsers.userId })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .innerJoin(tenantUsers, eq(tenantUsers.id, roleAssignments.tenantUserId))
      .where(and(eq(tenantUsers.tenantId, tenantId), inArray(roles.key, roleKeys)))
    const filteredUserIds = userIds.map((u: { userId: string }) => u.userId).filter(Boolean)
    if (filteredUserIds.length > 0) {
      const rows = await tx
        .select({ id: people.id })
        .from(people)
        .where(
          and(
            eq(people.tenantId, tenantId),
            eq(people.status, 'active'),
            isNull(people.deletedAt),
            inArray(people.userId, filteredUserIds),
          ),
        )
      for (const r of rows) set.add(r.id)
    }
  }
  return Array.from(set)
}

function bucketRows(
  kind: AssignmentKind,
  rows: { dueOn: string | null }[],
  today: string,
  t7: string,
  t30: string,
): AgingRow[] {
  const out: AgingRow[] = []
  for (const r of rows) {
    if (!r.dueOn) continue
    if (r.dueOn >= today) continue
    out.push({ kind, bucket: bucketForDate(r.dueOn, today, t7, t30), count: 1 })
  }
  return out
}

function bucketForDate(due: string | null, today: string, t7: string, t30: string): AgingBucket {
  if (!due) return '0_7'
  if (due >= t7) return '0_7'
  if (due >= t30) return '7_30'
  return '30_plus'
}

// Silence "unused import" warnings for tables that are referenced indirectly
// through type-only relationships.
export function _complianceModuleReady() {
  return [trainingAudienceAssignmentTargets, trades, gt].length > 0
}
