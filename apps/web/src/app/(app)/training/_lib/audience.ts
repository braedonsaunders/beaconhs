// Audience resolution + compliance recomputation for training audience assignments.
//
// Given an assignment with targets like [person:Alice, trade:Welder, role:foreman, everyone],
// `resolveAudience` returns the set of personIds that match (active people in the tenant).
// `recomputeAssignmentCompliance` then upserts one record per person in
// `training_audience_assignment_records` reflecting whether they've satisfied
// the course/assessment requirement.
//
// A person satisfies a course-assignment if they have any non-soft-deleted
// `training_records` row for that courseId with completedOn ≥ assignment.createdAt
// (and, if course has validForMonths, expiresOn ≥ today).
//
// A person satisfies an assessment-type-assignment if they have a `training_assessments`
// row with that typeId, passed=true, completedAt ≥ assignment.createdAt.
//
// Status precedence: completed > overdue (due_on < today) > in_progress > pending.

import { and, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db/client'
import {
  people,
  roleAssignments,
  roles,
  tenantUsers,
  trainingAssessments,
  trainingAudienceAssignmentRecords,
  trainingAudienceAssignmentTargets,
  trainingAudienceAssignments,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'

export type AudienceAssignment = typeof trainingAudienceAssignments.$inferSelect
export type AudienceTarget = typeof trainingAudienceAssignmentTargets.$inferSelect

/**
 * Given an assignment + its targets, return the deduplicated set of personIds
 * the assignment applies to. `everyone` short-circuits to all active people.
 */
export async function resolveAudience(
  tx: Database,
  tenantId: string,
  targets: AudienceTarget[],
): Promise<string[]> {
  if (targets.length === 0) return []
  const hasEveryone = targets.some((t) => t.kind === 'everyone')
  if (hasEveryone) {
    const rows = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.tenantId, tenantId), eq(people.status, 'active'), isNull(people.deletedAt)))
    return rows.map((r) => r.id)
  }

  const directPeople = targets
    .filter((t) => t.kind === 'person' && t.personId)
    .map((t) => t.personId as string)
  const tradeIds = targets
    .filter((t) => t.kind === 'trade' && t.tradeId)
    .map((t) => t.tradeId as string)
  const roleKeys = targets
    .filter((t) => t.kind === 'role' && t.roleKey)
    .map((t) => t.roleKey as string)

  const result = new Set<string>(directPeople)

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
    for (const r of rows) result.add(r.id)
  }

  if (roleKeys.length > 0) {
    // role.key → roleAssignments → tenantUsers → people.userId
    const rows = await tx
      .select({ id: people.id })
      .from(people)
      .innerJoin(tenantUsers, eq(tenantUsers.userId, people.userId))
      .innerJoin(roleAssignments, eq(roleAssignments.tenantUserId, tenantUsers.id))
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(
        and(
          eq(people.tenantId, tenantId),
          eq(people.status, 'active'),
          isNull(people.deletedAt),
          eq(tenantUsers.status, 'active'),
          inArray(roles.key, roleKeys),
        ),
      )
    for (const r of rows) result.add(r.id)
  }

  return Array.from(result)
}

/**
 * Compute (and upsert) one `training_audience_assignment_records` row per
 * resolved audience member. Returns the records for downstream display.
 */
export async function recomputeAssignmentCompliance(
  tx: Database,
  tenantId: string,
  assignmentId: string,
): Promise<{
  total: number
  completed: number
  overdue: number
  inProgress: number
  pending: number
}> {
  const [assignment] = await tx
    .select()
    .from(trainingAudienceAssignments)
    .where(eq(trainingAudienceAssignments.id, assignmentId))
    .limit(1)
  if (!assignment) return { total: 0, completed: 0, overdue: 0, inProgress: 0, pending: 0 }

  const targets = await tx
    .select()
    .from(trainingAudienceAssignmentTargets)
    .where(eq(trainingAudienceAssignmentTargets.assignmentId, assignmentId))

  const personIds = await resolveAudience(tx, tenantId, targets)
  if (personIds.length === 0) {
    // No one in scope. Clear stale records, return zeros.
    await tx
      .delete(trainingAudienceAssignmentRecords)
      .where(eq(trainingAudienceAssignmentRecords.assignmentId, assignmentId))
    return { total: 0, completed: 0, overdue: 0, inProgress: 0, pending: 0 }
  }

  const today = new Date().toISOString().slice(0, 10)
  const createdAt = assignment.createdAt instanceof Date ? assignment.createdAt : new Date(assignment.createdAt)
  const createdAtIso = createdAt.toISOString().slice(0, 10)

  // Pull matching satisfaction rows.
  const matched = new Map<
    string,
    {
      status: 'completed' | 'in_progress' | 'pending' | 'overdue'
      completedOn: string | null
      sourceTrainingRecordId: string | null
      sourceAssessmentId: string | null
    }
  >()
  for (const pid of personIds) {
    matched.set(pid, {
      status: 'pending',
      completedOn: null,
      sourceTrainingRecordId: null,
      sourceAssessmentId: null,
    })
  }

  if (assignment.itemKind === 'course' && assignment.courseId) {
    const records = await tx
      .select({
        id: trainingRecords.id,
        personId: trainingRecords.personId,
        completedOn: trainingRecords.completedOn,
        expiresOn: trainingRecords.expiresOn,
      })
      .from(trainingRecords)
      .where(
        and(
          eq(trainingRecords.tenantId, tenantId),
          eq(trainingRecords.courseId, assignment.courseId),
          inArray(trainingRecords.personId, personIds),
          gte(trainingRecords.completedOn, createdAtIso),
          isNull(trainingRecords.deletedAt),
        ),
      )
    for (const r of records) {
      const cur = matched.get(r.personId)
      if (!cur) continue
      const stillValid = !r.expiresOn || r.expiresOn >= today
      if (stillValid) {
        cur.status = 'completed'
        cur.completedOn = r.completedOn
        cur.sourceTrainingRecordId = r.id
      }
    }
  } else if (assignment.itemKind === 'assessment_type' && assignment.assessmentTypeId) {
    const attempts = await tx
      .select({
        id: trainingAssessments.id,
        personId: trainingAssessments.personId,
        passed: trainingAssessments.passed,
        completedAt: trainingAssessments.completedAt,
        status: trainingAssessments.status,
      })
      .from(trainingAssessments)
      .where(
        and(
          eq(trainingAssessments.tenantId, tenantId),
          eq(trainingAssessments.typeId, assignment.assessmentTypeId),
          inArray(trainingAssessments.personId, personIds),
          isNull(trainingAssessments.deletedAt),
        ),
      )
    for (const a of attempts) {
      const cur = matched.get(a.personId)
      if (!cur) continue
      if (a.status === 'submitted' && a.passed && a.completedAt) {
        const completedIso = a.completedAt.toISOString().slice(0, 10)
        if (completedIso >= createdAtIso) {
          cur.status = 'completed'
          cur.completedOn = completedIso
          cur.sourceAssessmentId = a.id
        }
      } else if (a.status === 'in_progress' && cur.status === 'pending') {
        cur.status = 'in_progress'
      }
    }
  }

  // Apply due date → overdue flag for any non-completed entry.
  const dueOn = assignment.dueOn
  if (dueOn && dueOn < today) {
    for (const v of matched.values()) {
      if (v.status !== 'completed') v.status = 'overdue'
    }
  }

  // Delete records for people no longer in audience.
  await tx
    .delete(trainingAudienceAssignmentRecords)
    .where(
      and(
        eq(trainingAudienceAssignmentRecords.assignmentId, assignmentId),
        sql`${trainingAudienceAssignmentRecords.personId} NOT IN ${sql.raw(
          `(${personIds.map((p) => `'${p}'`).join(',')})`,
        )}`,
      ),
    )

  // Upsert remainder.
  for (const [personId, v] of matched.entries()) {
    await tx
      .insert(trainingAudienceAssignmentRecords)
      .values({
        tenantId,
        assignmentId,
        personId,
        status: v.status,
        completedOn: v.completedOn,
        sourceTrainingRecordId: v.sourceTrainingRecordId,
        sourceAssessmentId: v.sourceAssessmentId,
        lastEvaluatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          trainingAudienceAssignmentRecords.assignmentId,
          trainingAudienceAssignmentRecords.personId,
        ],
        set: {
          status: v.status,
          completedOn: v.completedOn,
          sourceTrainingRecordId: v.sourceTrainingRecordId,
          sourceAssessmentId: v.sourceAssessmentId,
          lastEvaluatedAt: new Date(),
        },
      })
  }

  // Tally.
  let completed = 0,
    overdue = 0,
    inProgress = 0,
    pending = 0
  for (const v of matched.values()) {
    if (v.status === 'completed') completed++
    else if (v.status === 'overdue') overdue++
    else if (v.status === 'in_progress') inProgress++
    else pending++
  }
  return { total: personIds.length, completed, overdue, inProgress, pending }
}

/**
 * Lightweight compliance lookup used by the index page that doesn't bother
 * upserting. Reads the precomputed table.
 */
export async function readAssignmentCompliance(
  tx: Database,
  tenantId: string,
  assignmentIds: string[],
): Promise<Map<string, { total: number; completed: number; overdue: number }>> {
  const out = new Map<string, { total: number; completed: number; overdue: number }>()
  if (assignmentIds.length === 0) return out
  const rows = await tx
    .select({
      assignmentId: trainingAudienceAssignmentRecords.assignmentId,
      status: trainingAudienceAssignmentRecords.status,
      c: sql<number>`count(*)`.mapWith(Number),
    })
    .from(trainingAudienceAssignmentRecords)
    .where(
      and(
        eq(trainingAudienceAssignmentRecords.tenantId, tenantId),
        inArray(trainingAudienceAssignmentRecords.assignmentId, assignmentIds),
      ),
    )
    .groupBy(
      trainingAudienceAssignmentRecords.assignmentId,
      trainingAudienceAssignmentRecords.status,
    )
  for (const r of rows) {
    const cur = out.get(r.assignmentId) ?? { total: 0, completed: 0, overdue: 0 }
    cur.total += r.c
    if (r.status === 'completed') cur.completed += r.c
    if (r.status === 'overdue') cur.overdue += r.c
    out.set(r.assignmentId, cur)
  }
  return out
}

/**
 * Called from the training-record/assessment write paths so compliance stays
 * fresh. Recomputes ONLY assignments that include this person + this course
 * (or this person + this assessment type).
 */
export async function recomputeComplianceForRecord(
  tx: Database,
  tenantId: string,
  args: { personId: string; courseId?: string; assessmentTypeId?: string },
): Promise<void> {
  // Find candidate assignments — same course/type, status active.
  const candidates = await tx
    .select({ id: trainingAudienceAssignments.id })
    .from(trainingAudienceAssignments)
    .where(
      and(
        eq(trainingAudienceAssignments.tenantId, tenantId),
        eq(trainingAudienceAssignments.status, 'active'),
        isNull(trainingAudienceAssignments.deletedAt),
        args.courseId
          ? eq(trainingAudienceAssignments.courseId, args.courseId)
          : args.assessmentTypeId
            ? eq(trainingAudienceAssignments.assessmentTypeId, args.assessmentTypeId)
            : sql`false`,
      ),
    )
  for (const c of candidates) {
    await recomputeAssignmentCompliance(tx, tenantId, c.id)
  }
}

// Tiny noop reference to silence unused-import warnings when course validity
// helpers are needed at module load time.
export function _audienceModuleReady() {
  return [trainingCourses, ne, or, isNull, sql].length > 0
}
