// Per-module completion adapters + the evaluation orchestrator.
//
// `evaluateObligation(tx, tenantId, ob, audience)` takes a unified
// `compliance_obligations` row + its audience and returns one status row per
// SUBJECT — a person (per_person), a record (per_record), or a task×person
// (per_task) — by reading each module's OWN completion tables. Pure: takes a
// `tx`, so the web wraps it in `ctx.db(...)` and the worker in `withTenant(...)`
// (the compliance scanner runs per-tenant with RLS applied). Every query still
// pins tenantId explicitly as defense-in-depth.

import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notInArray,
  sql,
} from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  complianceObligations,
  correctiveActions,
  documentAcknowledgments,
  documentVersions,
  equipmentItems,
  formResponses,
  hazidAssessmentSignatures,
  hazidAssessments,
  inspectionRecords,
  jobTitleTaskAcknowledgments,
  jobTitleTasks,
  journalEntries,
  people,
  personTitleAssignments,
  ppeItems,
  ppeTypes,
  tenantUsers,
  trainingAssessments,
  trainingEnrollments,
  trainingRecords,
  trainingSkillAssignments,
} from '@beaconhs/db/schema'
import { type AudienceItem, type ResolvedMember, resolveObligationAudience } from './audience'
import {
  complianceDate,
  type ComplianceClock,
  frequencyProgress,
  resolveCronWindow,
  resolveFrequencyWindow,
} from './schedule'
import {
  resolveTrainingEvaluationWindow,
  type TrainingEvidence,
  trainingEvidenceInWindow,
  trainingEvidenceOutcome,
} from './training-evaluation'

export type ComplianceObligation = typeof complianceObligations.$inferSelect

export type EvalStatus = 'completed' | 'overdue' | 'pending' | 'in_progress' | 'expiring'

export type EvalSubjectRow = {
  key: string
  label: string
  personId: string | null
  // Direct login user to self-target, when the subject is owned by a tenantUser
  // rather than a `people` row (e.g. a corrective action's owner). Preferred over
  // the personId→people.userId bridge when set.
  userId?: string | null
  subjectRef: Record<string, string> | null
  status: EvalStatus
  dueOn: string | null
  completedOn: string | null
  periodStart?: string | null
  periodEnd?: string | null
  count?: number
  expected?: number
  percent?: number
}

export type EvalResult = {
  rows: EvalSubjectRow[]
  totals: { total: number; completed: number; overdue: number; pending: number }
  percent: number
  nextDueAt: Date | null
}

type Tx = Database
type Ob = ComplianceObligation

function empty(): EvalResult {
  return {
    rows: [],
    totals: { total: 0, completed: 0, overdue: 0, pending: 0 },
    percent: 0,
    nextDueAt: null,
  }
}

function tally(rows: EvalSubjectRow[], nextDueAt: Date | null = null): EvalResult {
  const total = rows.length
  const completed = rows.filter((r) => r.status === 'completed').length
  const overdue = rows.filter((r) => r.status === 'overdue' || r.status === 'expiring').length
  const pending = total - completed - overdue
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100)
  const rank = (s: EvalStatus) =>
    s === 'overdue' ? 0 : s === 'expiring' ? 1 : s === 'pending' ? 2 : s === 'in_progress' ? 3 : 4
  rows.sort((a, b) => rank(a.status) - rank(b.status) || a.label.localeCompare(b.label))
  return { rows, totals: { total, completed, overdue, pending }, percent, nextDueAt }
}

function pname(first: string | null, last: string | null): string {
  return `${last ?? ''}${last && first ? ', ' : ''}${first ?? ''}`.trim() || '(unnamed)'
}

async function loadNames(tx: Tx, tid: string, ids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  if (ids.length === 0) return m
  const rows = await tx
    .select({ id: people.id, first: people.firstName, last: people.lastName })
    .from(people)
    .where(and(eq(people.tenantId, tid), inArray(people.id, ids)))
  for (const r of rows) m.set(r.id, pname(r.first, r.last))
  return m
}

/** The orchestrator: dispatch to the right adapter by sourceModule. */
export async function evaluateObligation(
  tx: Tx,
  tenantId: string,
  ob: Ob,
  audience: AudienceItem[],
  clock: ComplianceClock = { now: new Date(), timezone: 'UTC' },
): Promise<EvalResult> {
  const today = complianceDate(clock)
  const aud = () => resolveObligationAudience(tx, tenantId, audience)
  switch (ob.sourceModule) {
    case 'training':
    case 'cert_requirement':
      return evalTraining(tx, tenantId, await aud(), ob, clock)
    case 'document':
      return evalDocument(tx, tenantId, await aud(), ob, today)
    case 'journal':
      return evalJournal(tx, tenantId, await aud(), ob, clock)
    case 'form':
      return evalForm(tx, tenantId, await aud(), ob, clock)
    case 'inspection':
      return evalInspection(tx, tenantId, await aud(), ob, clock)
    case 'hazard_assessment':
      return evalHazardAssessment(tx, tenantId, await aud(), ob, clock)
    case 'equipment_inspection':
      return evalEquipment(tx, tenantId, ob, today)
    case 'ppe_inspection':
      return evalPpe(tx, tenantId, ob, today)
    case 'corrective_action':
      return evalCorrectiveAction(tx, tenantId, ob, today)
    case 'job_title_signoff':
      return evalJobTitle(tx, tenantId, ob)
    default:
      return empty()
  }
}

// ---- per_person adapters --------------------------------------------------

function personRow(
  pid: string,
  name: string,
  status: EvalStatus,
  extra: Partial<EvalSubjectRow> = {},
): EvalSubjectRow {
  return {
    key: `person:${pid}`,
    label: name,
    personId: pid,
    subjectRef: null,
    status,
    dueOn: null,
    completedOn: null,
    ...extra,
  }
}

async function evalTraining(
  tx: Tx,
  tid: string,
  members: ResolvedMember[],
  ob: Ob,
  clock: ComplianceClock,
): Promise<EvalResult> {
  if (members.length === 0) return empty()
  const ids = members.map((m) => m.personId)
  const names = await loadNames(tx, tid, ids)
  const ref = ob.targetRef ?? {}
  const today = complianceDate(clock)
  const window = resolveTrainingEvaluationWindow(ob.recurrence, clock, ob.createdAt)
  const done = new Map<string, TrainingEvidence>()
  const inProgress = new Set<string>()

  const remember = (personId: string, evidence: TrainingEvidence) => {
    // Outside expiry mode an expired credential cannot satisfy an assignment.
    if (ob.recurrence.kind !== 'expiry' && evidence.expiresOn && evidence.expiresOn < today) return
    const prior = done.get(personId)
    if (!prior) {
      done.set(personId, evidence)
      return
    }
    if (ob.recurrence.kind === 'expiry') {
      // Pick the credential with the longest remaining validity. No expiry is
      // stronger than any dated expiry, even if another row was completed later.
      if (!prior.expiresOn) return
      if (!evidence.expiresOn || evidence.expiresOn > prior.expiresOn) {
        done.set(personId, evidence)
      } else if (
        evidence.expiresOn === prior.expiresOn &&
        evidence.completedOn > prior.completedOn
      ) {
        done.set(personId, evidence)
      }
      return
    }
    if (evidence.completedOn > prior.completedOn) done.set(personId, evidence)
  }

  if (ref.trainingItemKind === 'assessment_type' && ref.assessmentTypeId) {
    const rows = await tx
      .select({
        personId: trainingAssessments.personId,
        completedAt: trainingAssessments.completedAt,
      })
      .from(trainingAssessments)
      .where(
        and(
          eq(trainingAssessments.tenantId, tid),
          eq(trainingAssessments.typeId, ref.assessmentTypeId),
          eq(trainingAssessments.complianceObligationId, ob.id),
          inArray(trainingAssessments.personId, ids),
          eq(trainingAssessments.passed, true),
          eq(trainingAssessments.status, 'submitted'),
          isNull(trainingAssessments.deletedAt),
          window.evidenceStartAt
            ? gte(trainingAssessments.completedAt, window.evidenceStartAt)
            : undefined,
          window.evidenceEndAt
            ? lt(trainingAssessments.completedAt, window.evidenceEndAt)
            : undefined,
        ),
      )
    for (const r of rows) {
      if (!r.completedAt || !trainingEvidenceInWindow(r.completedAt, window)) continue
      remember(r.personId, {
        completedOn: complianceDate({ now: r.completedAt, timezone: clock.timezone }),
        expiresOn: null,
      })
    }

    const attempts = await tx
      .select({ personId: trainingAssessments.personId, startedAt: trainingAssessments.startedAt })
      .from(trainingAssessments)
      .where(
        and(
          eq(trainingAssessments.tenantId, tid),
          eq(trainingAssessments.typeId, ref.assessmentTypeId),
          eq(trainingAssessments.complianceObligationId, ob.id),
          inArray(trainingAssessments.personId, ids),
          eq(trainingAssessments.status, 'in_progress'),
          isNull(trainingAssessments.deletedAt),
          window.evidenceStartAt
            ? gte(trainingAssessments.startedAt, window.evidenceStartAt)
            : undefined,
          window.evidenceEndAt
            ? lt(trainingAssessments.startedAt, window.evidenceEndAt)
            : undefined,
        ),
      )
    for (const attempt of attempts) {
      if (trainingEvidenceInWindow(attempt.startedAt, window)) inProgress.add(attempt.personId)
    }
  } else if (ref.courseId) {
    const rows = await tx
      .select({
        personId: trainingRecords.personId,
        completedOn: trainingRecords.completedOn,
        expiresOn: trainingRecords.expiresOn,
      })
      .from(trainingRecords)
      .where(
        and(
          eq(trainingRecords.tenantId, tid),
          eq(trainingRecords.courseId, ref.courseId),
          inArray(trainingRecords.personId, ids),
          isNull(trainingRecords.deletedAt),
          window.evidenceStartOn
            ? gte(trainingRecords.completedOn, window.evidenceStartOn)
            : undefined,
          window.evidenceEndOn ? lte(trainingRecords.completedOn, window.evidenceEndOn) : undefined,
        ),
      )
    for (const r of rows) {
      // personId is nullable (blank drafts); the inArray filter already excludes
      // nulls, so this guard only narrows the type.
      if (!r.personId || !trainingEvidenceInWindow(r.completedOn, window)) continue
      remember(r.personId, { completedOn: r.completedOn, expiresOn: r.expiresOn })
    }

    const enrollments = await tx
      .select({
        personId: trainingEnrollments.personId,
        startedAt: trainingEnrollments.startedAt,
        createdAt: trainingEnrollments.createdAt,
      })
      .from(trainingEnrollments)
      .where(
        and(
          eq(trainingEnrollments.tenantId, tid),
          eq(trainingEnrollments.courseId, ref.courseId),
          inArray(trainingEnrollments.personId, ids),
          eq(trainingEnrollments.status, 'in_progress'),
          isNull(trainingEnrollments.deletedAt),
        ),
      )
    for (const enrollment of enrollments) {
      if (trainingEvidenceInWindow(enrollment.startedAt ?? enrollment.createdAt, window)) {
        inProgress.add(enrollment.personId)
      }
    }
  } else if (ref.skillTypeId) {
    // cert_requirement satisfied by holding a valid (non-expired) skill grant of this type
    const rows = await tx
      .select({
        personId: trainingSkillAssignments.personId,
        grantedOn: trainingSkillAssignments.grantedOn,
        expiresOn: trainingSkillAssignments.expiresOn,
      })
      .from(trainingSkillAssignments)
      .where(
        and(
          eq(trainingSkillAssignments.tenantId, tid),
          eq(trainingSkillAssignments.skillTypeId, ref.skillTypeId),
          inArray(trainingSkillAssignments.personId, ids),
          isNull(trainingSkillAssignments.deletedAt),
        ),
      )
    for (const r of rows) {
      if (r.personId) remember(r.personId, { completedOn: r.grantedOn, expiresOn: r.expiresOn })
    }
  } else {
    throw new Error(`Training obligation ${ob.id} has no supported target`)
  }

  return tally(
    ids.map((pid) => {
      const evidence = done.get(pid) ?? null
      const outcome = trainingEvidenceOutcome({
        recurrence: ob.recurrence,
        window,
        today,
        evidence,
        hasProgress: inProgress.has(pid),
      })
      return personRow(pid, names.get(pid) ?? '(unnamed)', outcome.status, {
        dueOn: outcome.dueOn,
        completedOn: outcome.completedOn,
        count: outcome.status === 'completed' ? 1 : 0,
        expected: 1,
        percent: outcome.status === 'completed' ? 100 : 0,
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
      })
    }),
    window.nextDueAt,
  )
}

async function evalDocument(
  tx: Tx,
  tid: string,
  members: ResolvedMember[],
  ob: Ob,
  today: string,
): Promise<EvalResult> {
  if (members.length === 0 || !ob.targetRef?.documentId) return empty()
  const ids = members.map((m) => m.personId)
  const names = await loadNames(tx, tid, ids)
  // Acknowledgments are per-version: republishing a document requires everyone to
  // re-acknowledge. Resolve the document's current published version (latest
  // published `document_versions` row, matching the module's own _ack-actions
  // logic) and only count acks for that version so republish resets compliance.
  const [current] = await tx
    .select({ id: documentVersions.id })
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.tenantId, tid),
        eq(documentVersions.documentId, ob.targetRef.documentId),
        isNotNull(documentVersions.publishedAt),
      ),
    )
    .orderBy(desc(documentVersions.version))
    .limit(1)
  if (!current) {
    // No published version yet — nobody can have acknowledged the current one.
    const dueOnNoVer = ob.recurrence?.dueOn ?? null
    return tally(
      ids.map((pid) =>
        personRow(
          pid,
          names.get(pid) ?? '(unnamed)',
          dueOnNoVer && dueOnNoVer < today ? 'overdue' : 'pending',
          { dueOn: dueOnNoVer, completedOn: null },
        ),
      ),
    )
  }
  const acks = await tx
    .select({
      personId: documentAcknowledgments.personId,
      at: documentAcknowledgments.acknowledgedAt,
    })
    .from(documentAcknowledgments)
    .where(
      and(
        eq(documentAcknowledgments.tenantId, tid),
        eq(documentAcknowledgments.documentId, ob.targetRef.documentId),
        eq(documentAcknowledgments.versionId, current.id),
        inArray(documentAcknowledgments.personId, ids),
      ),
    )
  const ackedAt = new Map<string, Date>()
  for (const a of acks) ackedAt.set(a.personId, a.at)
  const dueOn = ob.recurrence?.dueOn ?? null
  return tally(
    ids.map((pid) => {
      const a = ackedAt.get(pid)
      const status: EvalStatus = a ? 'completed' : dueOn && dueOn < today ? 'overdue' : 'pending'
      return personRow(pid, names.get(pid) ?? '(unnamed)', status, {
        dueOn,
        completedOn: a ? a.toISOString().slice(0, 10) : null,
      })
    }),
  )
}

async function evalJournal(
  tx: Tx,
  tid: string,
  members: ResolvedMember[],
  ob: Ob,
  clock: ComplianceClock,
): Promise<EvalResult> {
  if (members.length === 0) return empty()
  const ids = members.map((m) => m.personId)
  const names = await loadNames(tx, tid, ids)
  const window = resolveFrequencyWindow(ob.recurrence, clock, ob.createdAt)
  const expected = Math.max(1, ob.recurrence?.quantity ?? 1)
  const threshold = ob.recurrence?.compliantPercentage ?? 100
  const counts = await tx
    .select({
      personId: journalEntries.personId,
      c: sql<number>`count(*)::int`,
      completedOn: sql<string | null>`max(${journalEntries.entryDate})::text`,
    })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.tenantId, tid),
        inArray(journalEntries.personId, ids),
        gte(journalEntries.entryDate, window.periodStart),
        lte(journalEntries.entryDate, window.periodEnd),
        inArray(journalEntries.status, ['submitted', 'archived']),
        isNull(journalEntries.deletedAt),
      ),
    )
    .groupBy(journalEntries.personId)
  const byPerson = new Map<string, { count: number; completedOn: string | null }>()
  for (const r of counts) {
    if (r.personId) {
      byPerson.set(r.personId, { count: Number(r.c), completedOn: r.completedOn })
    }
  }
  return tally(
    ids.map((pid) => {
      const evidence = byPerson.get(pid)
      const n = evidence?.count ?? 0
      const progress = frequencyProgress(n, expected, threshold, window.dueAt, clock.now)
      return personRow(pid, names.get(pid) ?? '(unnamed)', progress.status, {
        count: n,
        expected,
        percent: progress.percent,
        dueOn: window.dueOn,
        completedOn: progress.status === 'completed' ? (evidence?.completedOn ?? null) : null,
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
      })
    }),
    window.nextDueAt,
  )
}

async function evalForm(
  tx: Tx,
  tid: string,
  members: ResolvedMember[],
  ob: Ob,
  clock: ComplianceClock,
): Promise<EvalResult> {
  if (members.length === 0 || !ob.targetRef?.formTemplateId) return empty()
  const ids = members.map((m) => m.personId)
  const names = await loadNames(tx, tid, ids)
  const window = resolveCronWindow(ob.recurrence, clock, ob.createdAt)
  // A scheduled app becomes actionable at its cron fire. Before the first
  // eligible fire there is no task to complete and no response can count as
  // early evidence; the worker materializes the first pending rows at the fire.
  if (!window.started) return { ...empty(), nextDueAt: window.dueAt }
  // Completion belongs to the response owner, not every person mentioned in
  // the payload. Join the immutable submittedBy membership directly: the
  // participant index deliberately deduplicates a person mentioned in a
  // picker, so its free-form role cannot reliably distinguish the submitter.
  const parts = await tx
    .select({
      responseId: formResponses.id,
      personId: people.id,
      submittedAt: formResponses.submittedAt,
    })
    .from(formResponses)
    .innerJoin(
      tenantUsers,
      and(
        eq(tenantUsers.tenantId, formResponses.tenantId),
        eq(tenantUsers.id, formResponses.submittedBy),
      ),
    )
    .innerJoin(
      people,
      and(eq(people.tenantId, tenantUsers.tenantId), eq(people.userId, tenantUsers.userId)),
    )
    .where(
      and(
        eq(formResponses.tenantId, tid),
        eq(formResponses.templateId, ob.targetRef.formTemplateId),
        inArray(people.id, ids),
        eq(formResponses.complianceObligationId, ob.id),
        inArray(formResponses.status, ['submitted', 'in_review', 'closed', 'non_compliant']),
        isNotNull(formResponses.submittedAt),
        gte(formResponses.submittedAt, window.evidenceStartAt),
        lt(formResponses.submittedAt, window.periodEndAt),
        isNull(formResponses.deletedAt),
      ),
    )
  const done = new Map<string, { completedOn: string; responseId: string; submittedAt: Date }>()
  for (const p of parts) {
    if (!p.submittedAt) continue
    const completedOn = complianceDate({ now: p.submittedAt, timezone: clock.timezone })
    const prior = done.get(p.personId)
    if (
      !prior ||
      p.submittedAt.getTime() > prior.submittedAt.getTime() ||
      (p.submittedAt.getTime() === prior.submittedAt.getTime() && p.responseId > prior.responseId)
    ) {
      done.set(p.personId, { completedOn, responseId: p.responseId, submittedAt: p.submittedAt })
    }
  }
  return tally(
    ids.map((pid) => {
      const evidence = done.get(pid)
      const status: EvalStatus = evidence
        ? 'completed'
        : window.started && clock.now.getTime() > window.dueAt.getTime()
          ? 'overdue'
          : 'pending'
      return personRow(pid, names.get(pid) ?? '(unnamed)', status, {
        subjectRef: evidence ? { responseId: evidence.responseId } : null,
        dueOn: window.dueOn,
        completedOn: evidence?.completedOn ?? null,
        count: evidence ? 1 : 0,
        expected: 1,
        percent: evidence ? 100 : 0,
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
      })
    }),
    window.nextDueAt,
  )
}

async function evalInspection(
  tx: Tx,
  tid: string,
  members: ResolvedMember[],
  ob: Ob,
  clock: ComplianceClock,
): Promise<EvalResult> {
  if (members.length === 0 || !ob.targetRef?.inspectionTypeId) return empty()
  const ids = members.map((m) => m.personId)
  const names = await loadNames(tx, tid, ids)
  const window = resolveFrequencyWindow(ob.recurrence, clock, ob.createdAt)
  const expected = Math.max(1, ob.recurrence?.quantity ?? 1)
  const threshold = ob.recurrence?.compliantPercentage ?? 100

  // Bridge person → tenantUser (inspection_records.inspectorTenantUserId).
  const userIds = members.map((m) => m.userId).filter((u): u is string => Boolean(u))
  const tuByUser = new Map<string, string>()
  if (userIds.length > 0) {
    const tus = await tx
      .select({ id: tenantUsers.id, userId: tenantUsers.userId })
      .from(tenantUsers)
      .where(and(eq(tenantUsers.tenantId, tid), inArray(tenantUsers.userId, userIds)))
    for (const t of tus) if (t.userId) tuByUser.set(t.userId, t.id)
  }
  const tuIds = Array.from(tuByUser.values())
  const countByTu = new Map<string, { count: number; completedOn: string | null }>()
  if (tuIds.length > 0) {
    const recs = await tx
      .select({
        tu: inspectionRecords.inspectorTenantUserId,
        c: sql<number>`count(*)::int`,
        completedOn: sql<string | null>`max(${inspectionRecords.occurredAt})::date::text`,
      })
      .from(inspectionRecords)
      .where(
        and(
          eq(inspectionRecords.tenantId, tid),
          eq(inspectionRecords.typeId, ob.targetRef.inspectionTypeId),
          inArray(inspectionRecords.status, ['submitted', 'closed']),
          gte(inspectionRecords.occurredAt, window.evidenceStartAt),
          lt(inspectionRecords.occurredAt, window.periodEndAt),
          inArray(inspectionRecords.inspectorTenantUserId, tuIds),
          isNull(inspectionRecords.deletedAt),
        ),
      )
      .groupBy(inspectionRecords.inspectorTenantUserId)
    for (const r of recs) {
      if (r.tu) countByTu.set(r.tu, { count: Number(r.c), completedOn: r.completedOn })
    }
  }

  return tally(
    members.map((m) => {
      const tu = m.userId ? tuByUser.get(m.userId) : undefined
      const evidence = tu ? countByTu.get(tu) : undefined
      const n = evidence?.count ?? 0
      const progress = frequencyProgress(n, expected, threshold, window.dueAt, clock.now)
      return personRow(m.personId, names.get(m.personId) ?? '(unnamed)', progress.status, {
        count: n,
        expected,
        percent: progress.percent,
        dueOn: window.dueOn,
        completedOn: progress.status === 'completed' ? (evidence?.completedOn ?? null) : null,
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
      })
    }),
    window.nextDueAt,
  )
}

/**
 * Hazard-assessment frequency compliance — the legacy "Hazard ID — Signatures"
 * report. Each person should PRODUCE (created) or SIGN a hazard assessment on
 * the obligation's cadence; we count both per period (mirroring the legacy
 * signatures + assessments-created tally) and compare to the expected quantity.
 * Created = `hazid_assessments.reported_by_tenant_user_id` (person→user→member
 * bridge); signed = `hazid_assessment_signatures.person_id` (direct), dated by
 * the parent assessment's `occurred_at`.
 */
async function evalHazardAssessment(
  tx: Tx,
  tid: string,
  members: ResolvedMember[],
  ob: Ob,
  clock: ComplianceClock,
): Promise<EvalResult> {
  if (members.length === 0) return empty()
  const ids = members.map((m) => m.personId)
  const names = await loadNames(tx, tid, ids)
  const window = resolveFrequencyWindow(ob.recurrence, clock, ob.createdAt)
  const expected = Math.max(1, ob.recurrence?.quantity ?? 1)
  const threshold = ob.recurrence?.compliantPercentage ?? 100

  // (a) Signatures BY the person in the period (dated via the parent assessment).
  const sigByPerson = new Map<string, number>()
  const sigRows = await tx
    .select({ personId: hazidAssessmentSignatures.personId, c: sql<number>`count(*)::int` })
    .from(hazidAssessmentSignatures)
    .innerJoin(hazidAssessments, eq(hazidAssessments.id, hazidAssessmentSignatures.assessmentId))
    .where(
      and(
        eq(hazidAssessmentSignatures.tenantId, tid),
        inArray(hazidAssessmentSignatures.personId, ids),
        isNotNull(hazidAssessmentSignatures.signedAt),
        eq(hazidAssessments.locked, true),
        gte(hazidAssessments.occurredAt, window.evidenceStartAt),
        lt(hazidAssessments.occurredAt, window.periodEndAt),
        isNull(hazidAssessments.deletedAt),
      ),
    )
    .groupBy(hazidAssessmentSignatures.personId)
  for (const r of sigRows) if (r.personId) sigByPerson.set(r.personId, Number(r.c))

  // (b) Assessments CREATED by the person in the period — bridge person→user→member.
  const userIds = members.map((m) => m.userId).filter((u): u is string => Boolean(u))
  const personByTu = new Map<string, string>() // tenantUserId → personId
  if (userIds.length > 0) {
    const tus = await tx
      .select({ id: tenantUsers.id, userId: tenantUsers.userId })
      .from(tenantUsers)
      .where(and(eq(tenantUsers.tenantId, tid), inArray(tenantUsers.userId, userIds)))
    const tuByUser = new Map<string, string>()
    for (const t of tus) if (t.userId) tuByUser.set(t.userId, t.id)
    for (const m of members) {
      const tu = m.userId ? tuByUser.get(m.userId) : undefined
      if (tu) personByTu.set(tu, m.personId)
    }
  }
  const createdByPerson = new Map<string, number>()
  const tuIds = Array.from(personByTu.keys())
  if (tuIds.length > 0) {
    const aRows = await tx
      .select({ tu: hazidAssessments.reportedByTenantUserId, c: sql<number>`count(*)::int` })
      .from(hazidAssessments)
      .where(
        and(
          eq(hazidAssessments.tenantId, tid),
          inArray(hazidAssessments.reportedByTenantUserId, tuIds),
          eq(hazidAssessments.locked, true),
          gte(hazidAssessments.occurredAt, window.evidenceStartAt),
          lt(hazidAssessments.occurredAt, window.periodEndAt),
          isNull(hazidAssessments.deletedAt),
        ),
      )
      .groupBy(hazidAssessments.reportedByTenantUserId)
    for (const r of aRows) {
      const pid = r.tu ? personByTu.get(r.tu) : undefined
      if (pid) createdByPerson.set(pid, Number(r.c))
    }
  }

  return tally(
    ids.map((pid) => {
      const n = (sigByPerson.get(pid) ?? 0) + (createdByPerson.get(pid) ?? 0)
      const progress = frequencyProgress(n, expected, threshold, window.dueAt, clock.now)
      return personRow(pid, names.get(pid) ?? '(unnamed)', progress.status, {
        count: n,
        expected,
        percent: progress.percent,
        dueOn: window.dueOn,
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
      })
    }),
    window.nextDueAt,
  )
}

// ---- per_record adapters --------------------------------------------------

function expiryStatus(due: string | null, today: string, remindDays: number): EvalStatus {
  if (!due) return 'completed' // no cadence configured ⇒ nothing outstanding
  if (due < today) return 'overdue'
  const horizon = new Date(`${today}T00:00:00Z`)
  horizon.setUTCDate(horizon.getUTCDate() + remindDays)
  return due <= horizon.toISOString().slice(0, 10) ? 'expiring' : 'completed'
}

function recordRow(
  id: string,
  label: string,
  status: EvalStatus,
  dueOn: string | null,
): EvalSubjectRow {
  return {
    key: `record:${id}`,
    label,
    personId: null,
    subjectRef: { recordId: id },
    status,
    dueOn,
    completedOn: null,
  }
}

async function evalEquipment(tx: Tx, tid: string, ob: Ob, today: string): Promise<EvalResult> {
  const remind = ob.recurrence?.remindBeforeDays ?? 30
  const typeId = ob.targetRef?.equipmentTypeId
  // An item's due date = the soonest next_due_on across its ACTIVE recurring
  // inspection schedules. No active schedule ⇒ null ⇒ 'completed' (nothing
  // outstanding), matching the pre-schedules behaviour for untracked items.
  const rows = await tx
    .select({
      id: equipmentItems.id,
      name: equipmentItems.name,
      tag: equipmentItems.assetTag,
      due: sql<string | null>`(
        select min(s.next_due_on)
        from equipment_inspection_schedules s
        where s.equipment_item_id = ${equipmentItems.id}
          and s.tenant_id = ${equipmentItems.tenantId}
          and s.is_active = true
      )`,
    })
    .from(equipmentItems)
    .where(
      and(
        eq(equipmentItems.tenantId, tid),
        typeId ? eq(equipmentItems.typeId, typeId) : undefined,
        eq(equipmentItems.isDraft, false),
        notInArray(equipmentItems.status, ['retired', 'lost']),
        isNull(equipmentItems.deletedAt),
      ),
    )
  return tally(
    rows.map((r) =>
      recordRow(r.id, `${r.name} (${r.tag})`, expiryStatus(r.due, today, remind), r.due),
    ),
  )
}

async function evalPpe(tx: Tx, tid: string, ob: Ob, today: string): Promise<EvalResult> {
  const remind = ob.recurrence?.remindBeforeDays ?? 30
  const typeId = ob.targetRef?.ppeTypeId
  const rows = await tx
    .select({
      id: ppeItems.id,
      serial: ppeItems.serialNumber,
      type: ppeTypes.name,
      inspection: ppeItems.nextInspectionDue,
      annualInspection: ppeItems.nextAnnualInspectionDue,
      expiresOn: ppeItems.expiresOn,
    })
    .from(ppeItems)
    .leftJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
    .where(
      and(
        eq(ppeItems.tenantId, tid),
        typeId ? eq(ppeItems.typeId, typeId) : undefined,
        notInArray(ppeItems.status, ['discarded', 'expired']),
        isNull(ppeItems.deletedAt),
      ),
    )
  return tally(
    rows.map((r) => {
      const due = [r.inspection, r.annualInspection, r.expiresOn].filter(Boolean).sort()[0] ?? null
      return recordRow(
        r.id,
        `${r.type ?? 'PPE'}${r.serial ? ` · ${r.serial}` : ''}`,
        expiryStatus(due, today, remind),
        due,
      )
    }),
  )
}

/**
 * Corrective-action overdue — the built-in detector that replaced the legacy
 * `ca_overdue_scan`. Every still-open CA must be closed by its `dueOn`; a CA
 * whose due date has passed is `overdue`. We set `personId` to the CA OWNER
 * (the assignee) so emitComplianceTransitions self-targets *them* — the few
 * applicable people — while the obligation's rollup still informs the
 * compliance-category audience configured in /admin/notifications. No audience
 * rows needed (per_record): we read the CA table directly, like equipment/PPE.
 */
async function evalCorrectiveAction(
  tx: Tx,
  tid: string,
  _ob: Ob,
  today: string,
): Promise<EvalResult> {
  const rows = await tx
    .select({
      id: correctiveActions.id,
      reference: correctiveActions.reference,
      title: correctiveActions.title,
      dueOn: correctiveActions.dueOn,
      ownerTenantUserId: correctiveActions.ownerTenantUserId,
    })
    .from(correctiveActions)
    .where(
      and(
        eq(correctiveActions.tenantId, tid),
        inArray(correctiveActions.status, ['open', 'in_progress', 'pending_verification']),
        isNotNull(correctiveActions.dueOn),
        isNull(correctiveActions.deletedAt),
      ),
    )
  if (rows.length === 0) return empty()

  // Resolve each CA owner (tenantUser) → login userId directly. A CA is owned by
  // a tenantUser, which frequently has NO linked `people` row, so we must NOT
  // route through the person bridge (it would silently target nobody) — we set
  // `userId` and let emitComplianceTransitions self-target the assignee directly.
  const ownerTuIds = [
    ...new Set(rows.map((r) => r.ownerTenantUserId).filter((u): u is string => Boolean(u))),
  ]
  const userByTu = new Map<string, string>()
  if (ownerTuIds.length > 0) {
    const tus = await tx
      .select({ id: tenantUsers.id, userId: tenantUsers.userId })
      .from(tenantUsers)
      .where(and(eq(tenantUsers.tenantId, tid), inArray(tenantUsers.id, ownerTuIds)))
    for (const t of tus) if (t.userId) userByTu.set(t.id, t.userId)
  }

  return tally(
    rows.map((r) => {
      const status: EvalStatus = r.dueOn && r.dueOn < today ? 'overdue' : 'pending'
      const userId = r.ownerTenantUserId ? (userByTu.get(r.ownerTenantUserId) ?? null) : null
      return {
        key: `record:${r.id}`,
        label: `${r.reference} — ${r.title}`,
        personId: null,
        userId,
        subjectRef: { recordId: r.id, caId: r.id },
        status,
        dueOn: r.dueOn,
        completedOn: null,
      }
    }),
  )
}

// ---- per_task adapter -----------------------------------------------------

async function evalJobTitle(tx: Tx, tid: string, ob: Ob): Promise<EvalResult> {
  const titleId = ob.targetRef?.jobTitleId
  if (!titleId) return empty()
  const tasks = await tx
    .select({ id: jobTitleTasks.id, task: jobTitleTasks.task })
    .from(jobTitleTasks)
    .where(
      and(
        eq(jobTitleTasks.tenantId, tid),
        eq(jobTitleTasks.titleId, titleId),
        isNull(jobTitleTasks.deletedAt),
      ),
    )
  if (tasks.length === 0) return empty()
  const holders = await tx
    .select({ id: people.id, first: people.firstName, last: people.lastName })
    .from(people)
    .innerJoin(
      personTitleAssignments,
      and(
        eq(personTitleAssignments.tenantId, people.tenantId),
        eq(personTitleAssignments.personId, people.id),
        eq(personTitleAssignments.titleId, titleId),
      ),
    )
    .where(and(eq(people.tenantId, tid), eq(people.status, 'active'), isNull(people.deletedAt)))
  if (holders.length === 0) return empty()
  const taskIds = tasks.map((t) => t.id)
  const personIds = holders.map((h) => h.id)
  const acks = await tx
    .select({
      taskId: jobTitleTaskAcknowledgments.taskId,
      personId: jobTitleTaskAcknowledgments.personId,
    })
    .from(jobTitleTaskAcknowledgments)
    .where(
      and(
        eq(jobTitleTaskAcknowledgments.tenantId, tid),
        inArray(jobTitleTaskAcknowledgments.taskId, taskIds),
        inArray(jobTitleTaskAcknowledgments.personId, personIds),
      ),
    )
  const acked = new Set(acks.map((a) => `${a.taskId}:${a.personId}`))
  const out: EvalSubjectRow[] = []
  for (const h of holders) {
    const name = pname(h.first, h.last)
    for (const t of tasks) {
      const ok = acked.has(`${t.id}:${h.id}`)
      out.push({
        key: `task:${t.id}:person:${h.id}`,
        label: `${name} — ${t.task}`,
        personId: h.id,
        subjectRef: { taskId: t.id },
        status: ok ? 'completed' : 'pending',
        dueOn: null,
        completedOn: null,
      })
    }
  }
  return tally(out)
}
