'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, asc, eq } from 'drizzle-orm'
import {
  people,
  trainingAssessmentResults,
  trainingAssessmentTypeQuestions,
  trainingAssessmentTypes,
  trainingAssessments,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import { can, type RequestContext } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { runModuleFlows } from '@/lib/flows/run-module-flows'
import { gradeAnswer, type QuestionKind } from '../_lib/grading'

/**
 * Resolve the signed-in user's People record id, or null when no People row is
 * linked to their login (e.g. an admin with no worker profile). Mirrors
 * resolvePersonId() in learn/_actions.ts but returns null instead of throwing,
 * so proctors without a People row fall through to the permission check below.
 */
async function resolveMyPersonId(ctx: RequestContext): Promise<string | null> {
  return ctx.db(async (tx) => {
    const [p] = await tx
      .select({ id: people.id })
      .from(people)
      .where(eq(people.userId, ctx.userId))
      .limit(1)
    return p?.id ?? null
  })
}

/**
 * A proctor/manager may start, answer, submit, or cancel an attempt on behalf of
 * another candidate; ordinary candidates may only act on their own attempt.
 * Either training-staff permission qualifies (recording training or running
 * classes) — the admin roles grant them together.
 */
function canProctorAssessments(ctx: RequestContext): boolean {
  return can(ctx, 'training.record.create') || can(ctx, 'training.class.manage')
}

/**
 * Begin a new assessment attempt. Creates the parent row + one
 * `training_assessment_results` shell per question (so the candidate view
 * can render directly off those rows).
 */
export async function startAssessmentAttempt(formData: FormData) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId: string = ctx.tenantId

  const typeId = String(formData.get('typeId') ?? '').trim()
  const personId = String(formData.get('personId') ?? '').trim()
  if (!typeId || !personId) throw new Error('Type and person are required')

  // Starting an attempt for another person is a proctor/manager action (it can
  // ultimately mint a training record for them). A learner may only start their
  // own; anyone else needs an explicit training-write permission.
  const myPersonId = await resolveMyPersonId(ctx)
  if (personId !== myPersonId && !canProctorAssessments(ctx)) {
    throw new Error('You can only start an assessment attempt for yourself')
  }

  const created = await ctx.db(async (tx) => {
    const [type] = await tx
      .select()
      .from(trainingAssessmentTypes)
      .where(eq(trainingAssessmentTypes.id, typeId))
      .limit(1)
    if (!type) throw new Error('Assessment type not found')

    const questions = await tx
      .select()
      .from(trainingAssessmentTypeQuestions)
      .where(eq(trainingAssessmentTypeQuestions.typeId, typeId))
      .orderBy(asc(trainingAssessmentTypeQuestions.entityOrder))

    const pointsPossible = questions.reduce((s, q) => s + (q.points ?? 1), 0)

    const [attempt] = await tx
      .insert(trainingAssessments)
      .values({
        tenantId,
        typeId,
        personId,
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
          tenantId,
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
  })

  await recordAudit(ctx, {
    entityType: 'training_assessment',
    entityId: created.id,
    action: 'create',
    summary: `Started assessment ${created.id}`,
    after: { typeId, personId },
  })
  redirect(`/training/assessments/${created.id}`)
}

/**
 * Submit (or re-grade) an attempt. Reads the user's answers from the form
 * payload — each result row has a field named `answer_<resultId>` — grades
 * each one server-side using the snapshotted correctAnswer, totals the
 * points, computes percentage, flips passed bool against passingScore, and
 * flips status to 'submitted'.
 *
 * If the type is linked to a course AND the attempt passed, a training_records
 * row is created so it lights up the matrix.
 */
export async function submitAssessmentAttempt(attemptId: string, formData: FormData) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId: string = ctx.tenantId
  const myPersonId = await resolveMyPersonId(ctx)

  const summary = await ctx.db(async (tx) => {
    const [attempt] = await tx
      .select()
      .from(trainingAssessments)
      .where(eq(trainingAssessments.id, attemptId))
      .limit(1)
    if (!attempt) throw new Error('Attempt not found')
    // Ownership: only the candidate (or a proctor/manager) may grade an attempt.
    // A server action is a POST endpoint, so without this any tenant user could
    // finalize someone else's in-progress attempt with arbitrary answers and
    // mint a training record for that other person.
    if (attempt.personId !== myPersonId && !canProctorAssessments(ctx)) {
      throw new Error('That assessment attempt is not yours')
    }
    if (attempt.status !== 'in_progress') throw new Error('Attempt is no longer editable')

    const results = await tx
      .select()
      .from(trainingAssessmentResults)
      .where(eq(trainingAssessmentResults.assessmentId, attemptId))

    let pointsAwarded = 0
    let pointsPossible = 0
    for (const r of results) {
      const answer = String(formData.get(`answer_${r.id}`) ?? '').trim() || null
      const correct = gradeAnswer(r.kindSnapshot as QuestionKind, r.correctAnswerSnapshot, answer)
      const awarded = correct === true ? (r.pointsPossible ?? 1) : 0
      pointsAwarded += awarded
      pointsPossible += r.pointsPossible ?? 1
      await tx
        .update(trainingAssessmentResults)
        .set({ answer, correct, pointsAwarded: awarded })
        .where(eq(trainingAssessmentResults.id, r.id))
    }
    const score = pointsPossible > 0 ? Math.round((pointsAwarded / pointsPossible) * 100) : 0
    const passed = score >= attempt.passingScore

    let trainingRecordId: string | null = null
    if (passed && attempt.courseId) {
      // Look up the linked course to compute expiry from validForMonths.
      const [course] = await tx
        .select()
        .from(trainingCourses)
        .where(eq(trainingCourses.id, attempt.courseId))
        .limit(1)
      const completedOn = new Date().toISOString().slice(0, 10)
      const expiresOn = course?.validForMonths
        ? new Date(Date.now() + course.validForMonths * 30 * 86_400_000).toISOString().slice(0, 10)
        : null
      const [rec] = await tx
        .insert(trainingRecords)
        .values({
          tenantId,
          personId: attempt.personId,
          courseId: attempt.courseId,
          source: 'self_paced',
          completedOn,
          expiresOn,
          score,
          grade: score,
          instructor: 'Assessment',
          details: `Auto-recorded from assessment attempt ${attempt.id}`,
          certificateType: 'auto',
        })
        .returning()
      trainingRecordId = rec?.id ?? null
    }

    await tx
      .update(trainingAssessments)
      .set({
        status: 'submitted',
        score,
        pointsAwarded,
        pointsPossible,
        passed,
        completedAt: new Date(),
        trainingRecordId,
      })
      .where(eq(trainingAssessments.id, attemptId))

    // Compliance is computed by the unified engine (the training adapter reads
    // training_records / training_assessments directly); no legacy recompute.
    return { score, passed, pointsAwarded, pointsPossible, trainingRecordId }
  })

  await recordAudit(ctx, {
    entityType: 'training_assessment',
    entityId: attemptId,
    action: 'sign',
    summary: `Submitted assessment ${attemptId} (${summary.score}%, ${summary.passed ? 'pass' : 'fail'})`,
    after: { ...summary },
  })
  await runModuleFlows(ctx, { moduleKey: 'training', event: 'on_submit', subjectId: attemptId })
  revalidatePath(`/training/assessments/${attemptId}`)
  revalidatePath('/training/assessments')
}

/**
 * Cancel an in-progress attempt (or mark a submitted attempt void).
 */
export async function cancelAssessmentAttempt(attemptId: string) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  const myPersonId = await resolveMyPersonId(ctx)

  await ctx.db(async (tx) => {
    const [attempt] = await tx
      .select({ personId: trainingAssessments.personId })
      .from(trainingAssessments)
      .where(eq(trainingAssessments.id, attemptId))
      .limit(1)
    if (!attempt) throw new Error('Attempt not found')
    if (attempt.personId !== myPersonId && !canProctorAssessments(ctx)) {
      throw new Error('That assessment attempt is not yours')
    }
    await tx
      .update(trainingAssessments)
      .set({ status: 'cancelled', completedAt: new Date() })
      .where(eq(trainingAssessments.id, attemptId))
  })
  await recordAudit(ctx, {
    entityType: 'training_assessment',
    entityId: attemptId,
    action: 'update',
    summary: `Cancelled assessment attempt ${attemptId}`,
  })
  revalidatePath(`/training/assessments/${attemptId}`)
  revalidatePath('/training/assessments')
}

/**
 * Bind a per-result update (used by a question-by-question UI). Not currently
 * wired into the default submit flow but exposed so an in-progress attempt
 * page can autosave.
 */
export async function setAssessmentAnswer(
  attemptId: string,
  resultId: string,
  answer: string | null,
) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  const myPersonId = await resolveMyPersonId(ctx)

  await ctx.db(async (tx) => {
    const [attempt] = await tx
      .select({ personId: trainingAssessments.personId, status: trainingAssessments.status })
      .from(trainingAssessments)
      .where(eq(trainingAssessments.id, attemptId))
      .limit(1)
    if (!attempt) throw new Error('Attempt not found')
    if (attempt.personId !== myPersonId && !canProctorAssessments(ctx)) {
      throw new Error('That assessment attempt is not yours')
    }
    if (attempt.status !== 'in_progress') throw new Error('Attempt is no longer editable')

    const [row] = await tx
      .select()
      .from(trainingAssessmentResults)
      .where(
        and(
          eq(trainingAssessmentResults.id, resultId),
          eq(trainingAssessmentResults.assessmentId, attemptId),
        ),
      )
      .limit(1)
    if (!row) return
    const correct = gradeAnswer(row.kindSnapshot as QuestionKind, row.correctAnswerSnapshot, answer)
    await tx
      .update(trainingAssessmentResults)
      .set({
        answer,
        correct,
        pointsAwarded: correct === true ? (row.pointsPossible ?? 1) : 0,
      })
      .where(eq(trainingAssessmentResults.id, resultId))
  })
  revalidatePath(`/training/assessments/${attemptId}`)
}
