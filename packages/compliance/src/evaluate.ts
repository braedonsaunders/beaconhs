// Per-module completion adapters + the evaluation orchestrator.
//
// `evaluateObligation(tx, tenantId, ob, audience)` takes a unified
// `compliance_obligations` row + its audience and returns one status row per
// SUBJECT — a person (per_person), a record (per_record), or a task×person
// (per_task) — by reading each module's OWN completion tables. Pure: takes a
// `tx`, so the web wraps it in `ctx.db(...)` and the worker in
// `withTenant(...)` / `withSuperAdmin(...)`.

import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  complianceObligations,
  documentAcknowledgments,
  equipmentItems,
  formResponseParticipants,
  inspectionRecords,
  jobTitleTaskAcknowledgments,
  jobTitleTasks,
  journalEntries,
  people,
  ppeItems,
  ppeTypes,
  tenantUsers,
  trainingAssessments,
  trainingRecords,
  trainingSkillAssignments,
} from '@beaconhs/db/schema'
import { type AudienceItem, type ResolvedMember, resolveObligationAudience } from './audience'

export type ComplianceObligation = typeof complianceObligations.$inferSelect

export type EvalStatus = 'completed' | 'overdue' | 'pending' | 'in_progress' | 'expiring'

export type EvalSubjectRow = {
  key: string
  label: string
  personId: string | null
  subjectRef: Record<string, string> | null
  status: EvalStatus
  dueOn: string | null
  completedOn: string | null
  count?: number
  expected?: number
}

export type EvalResult = {
  rows: EvalSubjectRow[]
  totals: { total: number; completed: number; overdue: number; pending: number }
  percent: number
}

type Tx = Database
type Ob = ComplianceObligation

function empty(): EvalResult {
  return { rows: [], totals: { total: 0, completed: 0, overdue: 0, pending: 0 }, percent: 0 }
}

function tally(rows: EvalSubjectRow[]): EvalResult {
  const total = rows.length
  const completed = rows.filter((r) => r.status === 'completed').length
  const overdue = rows.filter((r) => r.status === 'overdue' || r.status === 'expiring').length
  const pending = total - completed - overdue
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100)
  const rank = (s: EvalStatus) =>
    s === 'overdue' ? 0 : s === 'expiring' ? 1 : s === 'pending' ? 2 : s === 'in_progress' ? 3 : 4
  rows.sort((a, b) => rank(a.status) - rank(b.status) || a.label.localeCompare(b.label))
  return { rows, totals: { total, completed, overdue, pending }, percent }
}

function periodStart(freq: string | undefined, today: string): string {
  const d = new Date(`${today}T00:00:00Z`)
  if (freq === 'week') {
    const dow = d.getUTCDay()
    d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1))
  } else if (freq === 'month') {
    d.setUTCDate(1)
  } else if (freq === 'quarter') {
    d.setUTCMonth(Math.floor(d.getUTCMonth() / 3) * 3, 1)
  } else if (freq === 'year') {
    d.setUTCMonth(0, 1)
  }
  return d.toISOString().slice(0, 10)
}

function pname(first: string | null, last: string | null): string {
  return `${last ?? ''}${last && first ? ', ' : ''}${first ?? ''}`.trim() || '(unnamed)'
}

async function loadNames(tx: Tx, ids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  if (ids.length === 0) return m
  const rows = await tx
    .select({ id: people.id, first: people.firstName, last: people.lastName })
    .from(people)
    .where(inArray(people.id, ids))
  for (const r of rows) m.set(r.id, pname(r.first, r.last))
  return m
}

/** The orchestrator: dispatch to the right adapter by sourceModule. */
export async function evaluateObligation(
  tx: Tx,
  tenantId: string,
  ob: Ob,
  audience: AudienceItem[],
  today: string = new Date().toISOString().slice(0, 10),
): Promise<EvalResult> {
  const aud = () => resolveObligationAudience(tx, tenantId, audience)
  switch (ob.sourceModule) {
    case 'training':
    case 'cert_requirement':
      return evalTraining(tx, tenantId, await aud(), ob, today)
    case 'document':
      return evalDocument(tx, tenantId, await aud(), ob, today)
    case 'journal':
      return evalJournal(tx, tenantId, await aud(), ob, today)
    case 'form':
      return evalForm(tx, tenantId, await aud(), ob, today)
    case 'inspection':
      return evalInspection(tx, tenantId, await aud(), ob, today)
    case 'equipment_inspection':
      return evalEquipment(tx, tenantId, ob, today)
    case 'ppe_inspection':
      return evalPpe(tx, tenantId, ob, today)
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

async function evalTraining(tx: Tx, tid: string, members: ResolvedMember[], ob: Ob, today: string): Promise<EvalResult> {
  if (members.length === 0) return empty()
  const ids = members.map((m) => m.personId)
  const names = await loadNames(tx, ids)
  const ref = ob.targetRef ?? {}
  const done = new Map<string, string>() // personId -> completedOn

  if (ref.trainingItemKind === 'assessment_type' && ref.assessmentTypeId) {
    const rows = await tx
      .select({ personId: trainingAssessments.personId, completedAt: trainingAssessments.completedAt })
      .from(trainingAssessments)
      .where(
        and(
          eq(trainingAssessments.tenantId, tid),
          eq(trainingAssessments.typeId, ref.assessmentTypeId),
          inArray(trainingAssessments.personId, ids),
          eq(trainingAssessments.passed, true),
          eq(trainingAssessments.status, 'submitted'),
          isNull(trainingAssessments.deletedAt),
        ),
      )
    for (const r of rows) if (r.completedAt) done.set(r.personId, r.completedAt.toISOString().slice(0, 10))
  } else if (ref.courseId) {
    const rows = await tx
      .select({ personId: trainingRecords.personId, completedOn: trainingRecords.completedOn, expiresOn: trainingRecords.expiresOn })
      .from(trainingRecords)
      .where(
        and(
          eq(trainingRecords.tenantId, tid),
          eq(trainingRecords.courseId, ref.courseId),
          inArray(trainingRecords.personId, ids),
          isNull(trainingRecords.deletedAt),
        ),
      )
    for (const r of rows) {
      const valid = !r.expiresOn || r.expiresOn >= today
      if (valid) done.set(r.personId, r.completedOn)
    }
  } else if (ref.skillTypeId) {
    // cert_requirement satisfied by holding a valid (non-expired) skill grant of this type
    const rows = await tx
      .select({ personId: trainingSkillAssignments.personId, grantedOn: trainingSkillAssignments.grantedOn, expiresOn: trainingSkillAssignments.expiresOn })
      .from(trainingSkillAssignments)
      .where(
        and(
          eq(trainingSkillAssignments.tenantId, tid),
          eq(trainingSkillAssignments.skillTypeId, ref.skillTypeId),
          inArray(trainingSkillAssignments.personId, ids),
        ),
      )
    for (const r of rows) {
      const valid = !r.expiresOn || r.expiresOn >= today
      if (valid) done.set(r.personId, r.grantedOn)
    }
  }

  const dueOn = ob.recurrence?.dueOn ?? null
  return tally(
    ids.map((pid) => {
      const c = done.get(pid)
      const status: EvalStatus = c ? 'completed' : dueOn && dueOn < today ? 'overdue' : 'pending'
      return personRow(pid, names.get(pid) ?? '(unnamed)', status, { dueOn, completedOn: c ?? null })
    }),
  )
}

async function evalDocument(tx: Tx, tid: string, members: ResolvedMember[], ob: Ob, today: string): Promise<EvalResult> {
  if (members.length === 0 || !ob.targetRef?.documentId) return empty()
  const ids = members.map((m) => m.personId)
  const names = await loadNames(tx, ids)
  const acks = await tx
    .select({ personId: documentAcknowledgments.personId, at: documentAcknowledgments.acknowledgedAt })
    .from(documentAcknowledgments)
    .where(and(eq(documentAcknowledgments.documentId, ob.targetRef.documentId), inArray(documentAcknowledgments.personId, ids)))
  const ackedAt = new Map<string, Date>()
  for (const a of acks) ackedAt.set(a.personId, a.at)
  const dueOn = ob.recurrence?.dueOn ?? null
  return tally(
    ids.map((pid) => {
      const a = ackedAt.get(pid)
      const status: EvalStatus = a ? 'completed' : dueOn && dueOn < today ? 'overdue' : 'pending'
      return personRow(pid, names.get(pid) ?? '(unnamed)', status, { dueOn, completedOn: a ? a.toISOString().slice(0, 10) : null })
    }),
  )
}

async function evalJournal(tx: Tx, tid: string, members: ResolvedMember[], ob: Ob, today: string): Promise<EvalResult> {
  if (members.length === 0) return empty()
  const ids = members.map((m) => m.personId)
  const names = await loadNames(tx, ids)
  const since = periodStart(ob.recurrence?.frequency, today)
  const expected = Math.max(1, ob.recurrence?.quantity ?? 1)
  const counts = await tx
    .select({ personId: journalEntries.personId, c: sql<number>`count(*)::int` })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.tenantId, tid),
        inArray(journalEntries.personId, ids),
        gte(journalEntries.entryDate, since),
        isNull(journalEntries.deletedAt),
      ),
    )
    .groupBy(journalEntries.personId)
  const byPerson = new Map<string, number>()
  for (const r of counts) if (r.personId) byPerson.set(r.personId, Number(r.c))
  return tally(
    ids.map((pid) => {
      const n = byPerson.get(pid) ?? 0
      const status: EvalStatus = n >= expected ? 'completed' : n > 0 ? 'in_progress' : 'pending'
      return personRow(pid, names.get(pid) ?? '(unnamed)', status, { count: n, expected })
    }),
  )
}

async function evalForm(tx: Tx, tid: string, members: ResolvedMember[], ob: Ob, today: string): Promise<EvalResult> {
  if (members.length === 0 || !ob.targetRef?.formTemplateId) return empty()
  const ids = members.map((m) => m.personId)
  const names = await loadNames(tx, ids)
  const since = periodStart(ob.recurrence?.frequency ?? 'week', today)
  const parts = await tx
    .select({ personId: formResponseParticipants.personId, occurredOn: formResponseParticipants.occurredOn })
    .from(formResponseParticipants)
    .where(
      and(
        eq(formResponseParticipants.templateId, ob.targetRef.formTemplateId),
        inArray(formResponseParticipants.personId, ids),
        gte(formResponseParticipants.occurredOn, since),
      ),
    )
  const done = new Map<string, string>()
  for (const p of parts) if (p.occurredOn) done.set(p.personId, p.occurredOn)
  return tally(
    ids.map((pid) => {
      const c = done.get(pid)
      return personRow(pid, names.get(pid) ?? '(unnamed)', c ? 'completed' : 'pending', { completedOn: c ?? null })
    }),
  )
}

async function evalInspection(tx: Tx, tid: string, members: ResolvedMember[], ob: Ob, today: string): Promise<EvalResult> {
  if (members.length === 0 || !ob.targetRef?.inspectionTypeId) return empty()
  const ids = members.map((m) => m.personId)
  const names = await loadNames(tx, ids)
  const since = periodStart(ob.recurrence?.frequency, today)
  const expected = Math.max(1, ob.recurrence?.quantity ?? 1)

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
  const countByTu = new Map<string, number>()
  if (tuIds.length > 0) {
    const recs = await tx
      .select({ tu: inspectionRecords.inspectorTenantUserId, c: sql<number>`count(*)::int` })
      .from(inspectionRecords)
      .where(
        and(
          eq(inspectionRecords.tenantId, tid),
          eq(inspectionRecords.typeId, ob.targetRef.inspectionTypeId),
          inArray(inspectionRecords.status, ['submitted', 'closed']),
          gte(inspectionRecords.occurredAt, new Date(`${since}T00:00:00Z`)),
          inArray(inspectionRecords.inspectorTenantUserId, tuIds),
        ),
      )
      .groupBy(inspectionRecords.inspectorTenantUserId)
    for (const r of recs) if (r.tu) countByTu.set(r.tu, Number(r.c))
  }

  return tally(
    members.map((m) => {
      const tu = m.userId ? tuByUser.get(m.userId) : undefined
      const n = tu ? (countByTu.get(tu) ?? 0) : 0
      const status: EvalStatus = n >= expected ? 'completed' : n > 0 ? 'in_progress' : 'pending'
      return personRow(m.personId, names.get(m.personId) ?? '(unnamed)', status, { count: n, expected })
    }),
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

function recordRow(id: string, label: string, status: EvalStatus, dueOn: string | null): EvalSubjectRow {
  return { key: `record:${id}`, label, personId: null, subjectRef: { recordId: id }, status, dueOn, completedOn: null }
}

async function evalEquipment(tx: Tx, tid: string, ob: Ob, today: string): Promise<EvalResult> {
  const remind = ob.recurrence?.remindBeforeDays ?? 30
  const typeId = ob.targetRef?.equipmentTypeId
  const rows = await tx
    .select({ id: equipmentItems.id, name: equipmentItems.name, tag: equipmentItems.assetTag, due: equipmentItems.nextAnnualInspectionDue })
    .from(equipmentItems)
    .where(and(eq(equipmentItems.tenantId, tid), typeId ? eq(equipmentItems.typeId, typeId) : undefined, isNull(equipmentItems.deletedAt)))
    .limit(2000)
  return tally(rows.map((r) => recordRow(r.id, `${r.name} (${r.tag})`, expiryStatus(r.due, today, remind), r.due)))
}

async function evalPpe(tx: Tx, tid: string, ob: Ob, today: string): Promise<EvalResult> {
  const remind = ob.recurrence?.remindBeforeDays ?? 30
  const typeId = ob.targetRef?.ppeTypeId
  const rows = await tx
    .select({ id: ppeItems.id, serial: ppeItems.serialNumber, type: ppeTypes.name, inspection: ppeItems.nextInspectionDue, expiresOn: ppeItems.expiresOn })
    .from(ppeItems)
    .leftJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
    .where(and(eq(ppeItems.tenantId, tid), typeId ? eq(ppeItems.typeId, typeId) : undefined, isNull(ppeItems.deletedAt)))
    .limit(2000)
  return tally(
    rows.map((r) => {
      const due = [r.inspection, r.expiresOn].filter(Boolean).sort()[0] ?? null
      return recordRow(r.id, `${r.type ?? 'PPE'}${r.serial ? ` · ${r.serial}` : ''}`, expiryStatus(due, today, remind), due)
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
    .where(and(eq(jobTitleTasks.tenantId, tid), eq(jobTitleTasks.titleId, titleId)))
  if (tasks.length === 0) return empty()
  const holders = await tx
    .select({ id: people.id, first: people.firstName, last: people.lastName })
    .from(people)
    .where(
      and(
        eq(people.tenantId, tid),
        eq(people.status, 'active'),
        isNull(people.deletedAt),
        sql`${people.titleIds} @> ${JSON.stringify([titleId])}::jsonb`,
      ),
    )
  if (holders.length === 0) return empty()
  const taskIds = tasks.map((t) => t.id)
  const personIds = holders.map((h) => h.id)
  const acks = await tx
    .select({ taskId: jobTitleTaskAcknowledgments.taskId, personId: jobTitleTaskAcknowledgments.personId })
    .from(jobTitleTaskAcknowledgments)
    .where(and(inArray(jobTitleTaskAcknowledgments.taskId, taskIds), inArray(jobTitleTaskAcknowledgments.personId, personIds)))
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
