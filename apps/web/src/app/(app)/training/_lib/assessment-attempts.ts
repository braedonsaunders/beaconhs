// Shared assessment-attempt creation — the one place that snapshots a type's
// questions onto a new training_assessments row (+ one result shell per
// question). Used by the proctor "New assessment" flow and the LMS lesson-quiz
// launcher so the attempt shape can never drift between the two paths.

import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  trainingAssessmentResults,
  trainingAssessmentTypeQuestions,
  trainingAssessmentTypes,
  trainingAssessments,
} from '@beaconhs/db/schema'
import {
  assessmentAttemptRecordCourseId,
  type AssessmentAttemptSource,
} from './assessment-attempt-policy'

/**
 * Create an in-progress attempt with per-question result shells. Soft-deleted
 * types are always rejected; pass `requireActive` where attempts must come from
 * the live catalogue (the standalone attempt flow). Lesson quizzes skip the
 * active check so a type hidden from the catalogue keeps working for the
 * lessons still wired to it.
 *
 * Free-text questions are never auto-graded and there is no manual-marking
 * flow, so they are excluded from the scored points denominator — they render
 * as unscored reference answers on the attempt page.
 */
export async function createAssessmentAttempt(
  tx: Database,
  args: {
    tenantId: string
    typeId: string
    personId: string
    complianceObligationId?: string | null
    requireActive?: boolean
    source?: AssessmentAttemptSource
  },
): Promise<{ attempt: typeof trainingAssessments.$inferSelect; created: boolean }> {
  const [type] = await tx
    .select()
    .from(trainingAssessmentTypes)
    .where(
      and(eq(trainingAssessmentTypes.id, args.typeId), isNull(trainingAssessmentTypes.deletedAt)),
    )
    .limit(1)
  if (!type) throw new Error('Assessment type not found')
  if (args.requireActive && !type.active) throw new Error('This assessment type is inactive.')

  if (args.complianceObligationId) {
    const [existing] = await tx
      .select()
      .from(trainingAssessments)
      .where(
        and(
          eq(trainingAssessments.tenantId, args.tenantId),
          eq(trainingAssessments.complianceObligationId, args.complianceObligationId),
          eq(trainingAssessments.personId, args.personId),
          eq(trainingAssessments.typeId, args.typeId),
          eq(trainingAssessments.status, 'in_progress'),
          isNull(trainingAssessments.deletedAt),
        ),
      )
      .limit(1)
    if (existing) return { attempt: existing, created: false }
  }

  const questions = await tx
    .select()
    .from(trainingAssessmentTypeQuestions)
    .where(eq(trainingAssessmentTypeQuestions.typeId, type.id))
    .orderBy(asc(trainingAssessmentTypeQuestions.entityOrder))

  const pointsPossible = questions
    .filter((q) => q.kind !== 'text')
    .reduce((s, q) => s + (q.points ?? 1), 0)

  const [attempt] = await tx
    .insert(trainingAssessments)
    .values({
      tenantId: args.tenantId,
      typeId: type.id,
      personId: args.personId,
      courseId: assessmentAttemptRecordCourseId(type.courseId, args.source ?? 'standalone'),
      complianceObligationId: args.complianceObligationId ?? null,
      passingScore: type.passingScore,
      pointsPossible,
      status: 'in_progress',
    })
    .onConflictDoNothing({
      target: [
        trainingAssessments.tenantId,
        trainingAssessments.complianceObligationId,
        trainingAssessments.personId,
      ],
      where: sql`${trainingAssessments.complianceObligationId} is not null and ${trainingAssessments.status} = 'in_progress' and ${trainingAssessments.deletedAt} is null`,
    })
    .returning()
  if (!attempt) {
    if (!args.complianceObligationId) throw new Error('Failed to create assessment attempt')
    const [concurrent] = await tx
      .select()
      .from(trainingAssessments)
      .where(
        and(
          eq(trainingAssessments.tenantId, args.tenantId),
          eq(trainingAssessments.complianceObligationId, args.complianceObligationId),
          eq(trainingAssessments.personId, args.personId),
          eq(trainingAssessments.typeId, args.typeId),
          eq(trainingAssessments.status, 'in_progress'),
          isNull(trainingAssessments.deletedAt),
        ),
      )
      .limit(1)
    if (!concurrent) throw new Error('The active assigned assessment attempt is inconsistent')
    return { attempt: concurrent, created: false }
  }

  if (questions.length > 0) {
    await tx.insert(trainingAssessmentResults).values(
      questions.map((q) => ({
        tenantId: args.tenantId,
        assessmentId: attempt.id,
        questionId: q.id,
        promptSnapshot: q.prompt,
        correctAnswerSnapshot: q.correctAnswer,
        kindSnapshot: q.kind,
        pointsPossible: q.points ?? 1,
      })),
    )
  }
  return { attempt, created: true }
}
