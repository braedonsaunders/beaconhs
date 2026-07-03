// Shared assessment-attempt creation — the one place that snapshots a type's
// questions onto a new training_assessments row (+ one result shell per
// question). Used by the proctor "New attempt" flow and the LMS lesson-quiz
// launcher so the attempt shape can never drift between the two paths.

import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  trainingAssessmentResults,
  trainingAssessmentTypeQuestions,
  trainingAssessmentTypes,
  trainingAssessments,
} from '@beaconhs/db/schema'

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
  args: { tenantId: string; typeId: string; personId: string; requireActive?: boolean },
): Promise<typeof trainingAssessments.$inferSelect> {
  const [type] = await tx
    .select()
    .from(trainingAssessmentTypes)
    .where(
      and(eq(trainingAssessmentTypes.id, args.typeId), isNull(trainingAssessmentTypes.deletedAt)),
    )
    .limit(1)
  if (!type) throw new Error('Assessment type not found')
  if (args.requireActive && !type.active) throw new Error('This assessment type is inactive.')

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
      courseId: type.courseId,
      passingScore: type.passingScore,
      pointsPossible,
      status: 'in_progress',
    })
    .returning()
  if (!attempt) throw new Error('Failed to create assessment attempt')

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
  return attempt
}
