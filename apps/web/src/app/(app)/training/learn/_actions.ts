'use server'

// Learner runtime — enrollment, per-lesson progress, and the completion path.
//
// On finishing every REQUIRED lesson, the enrollment writes a training_records
// row (expiry from course.validForMonths) and mints a training_certificates row
// (+ opaque verify token); the existing PDF route/worker renders the cert on
// demand and the unified compliance engine reads the record. Quiz lessons reuse
// the existing native assessment engine (training_assessments).

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, asc, desc, eq } from 'drizzle-orm'
import { can, type RequestContext } from '@beaconhs/tenant'
import {
  people,
  trainingAssessmentResults,
  trainingAssessmentTypeQuestions,
  trainingAssessmentTypes,
  trainingAssessments,
  trainingEnrollments,
  trainingLessonProgress,
  trainingLessons,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { recomputeEnrollmentCompletion } from './_lib/completion'

// Resolve the signed-in user's People record id, or null when no People row is
// linked to their login (e.g. an admin with no worker profile). Workers without
// an app login have no people.user_id, so an explicit personId must be passed
// for those. Mirrors resolveMyPersonId() in ../_actions/assessments.ts.
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

// Own-action paths (self-enroll, lesson progress) require a linked People record;
// throw a clear error when nothing is linked.
async function resolvePersonId(ctx: RequestContext): Promise<string> {
  const id = await resolveMyPersonId(ctx)
  if (!id) {
    throw new Error(
      'No worker profile is linked to your account — ask an admin to link your People record.',
    )
  }
  return id
}

// Enrolling someone OTHER than yourself is a training-staff action: it assigns a
// course to them and ultimately mints a training record on their behalf. Either
// training-write permission qualifies — the admin roles grant them together.
// Mirrors canProctorAssessments() in ../_actions/assessments.ts.
function canAssignTraining(ctx: RequestContext): boolean {
  return can(ctx, 'training.record.create') || can(ctx, 'training.class.manage')
}

export async function enrollInCourse(courseId: string, personIdArg?: string) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId = ctx.tenantId

  // Assigning a course to another person is a privileged action. A server action
  // is a POST endpoint, so without this gate any authenticated tenant user could
  // enroll an arbitrary person on their behalf (source: 'assigned'). Self-enroll
  // (no personId, or your own personId) stays open; enrolling anyone else needs
  // an explicit training-write permission — same cross-user integrity class as
  // the assessment-attempt guards in ../_actions/assessments.ts.
  const requested = personIdArg?.trim()
  let assigning = false
  let personId: string
  if (!requested) {
    personId = await resolvePersonId(ctx)
  } else {
    const ownPersonId = await resolveMyPersonId(ctx)
    assigning = requested !== ownPersonId
    if (assigning && !canAssignTraining(ctx)) {
      throw new Error('You do not have permission to assign training to other people.')
    }
    personId = requested
  }

  await ctx.db(async (tx) => {
    const [existing] = await tx
      .select()
      .from(trainingEnrollments)
      .where(
        and(eq(trainingEnrollments.courseId, courseId), eq(trainingEnrollments.personId, personId)),
      )
      .limit(1)
    if (existing) {
      if (existing.status === 'not_started') {
        await tx
          .update(trainingEnrollments)
          .set({ status: 'in_progress', startedAt: existing.startedAt ?? new Date() })
          .where(eq(trainingEnrollments.id, existing.id))
      }
      return
    }
    await tx.insert(trainingEnrollments).values({
      tenantId,
      courseId,
      personId,
      status: 'in_progress',
      source: assigning ? 'assigned' : 'self',
      assignedByTenantUserId: assigning ? (ctx.membership?.id ?? null) : null,
      startedAt: new Date(),
    })
  })
  revalidatePath(`/training/learn/${courseId}`)
  revalidatePath('/training/learn')
}

export async function markLessonComplete(enrollmentId: string, lessonId: string) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId = ctx.tenantId
  const personId = await resolvePersonId(ctx)

  const result = await ctx.db(async (tx) => {
    const [enr] = await tx
      .select()
      .from(trainingEnrollments)
      .where(eq(trainingEnrollments.id, enrollmentId))
      .limit(1)
    if (!enr) throw new Error('Enrollment not found')
    if (enr.personId !== personId) throw new Error('That enrollment is not yours')

    const [lesson] = await tx
      .select()
      .from(trainingLessons)
      .where(eq(trainingLessons.id, lessonId))
      .limit(1)
    if (!lesson) throw new Error('Lesson not found')

    // Practical lessons can never be self-completed.
    if (lesson.completionRule === 'evaluator') {
      throw new Error('This lesson requires an evaluator sign-off.')
    }

    // Quiz lessons that gate on a pass require a passed attempt first.
    if (lesson.kind === 'quiz' && lesson.completionRule === 'pass') {
      if (!lesson.assessmentTypeId) throw new Error('This quiz has no assessment configured.')
      const [passedAttempt] = await tx
        .select({ id: trainingAssessments.id })
        .from(trainingAssessments)
        .where(
          and(
            eq(trainingAssessments.personId, personId),
            eq(trainingAssessments.typeId, lesson.assessmentTypeId),
            eq(trainingAssessments.passed, true),
          ),
        )
        .orderBy(desc(trainingAssessments.completedAt))
        .limit(1)
      if (!passedAttempt) throw new Error('Pass the quiz before completing this lesson.')
    }

    const now = new Date()
    const [existing] = await tx
      .select()
      .from(trainingLessonProgress)
      .where(
        and(
          eq(trainingLessonProgress.enrollmentId, enrollmentId),
          eq(trainingLessonProgress.lessonId, lessonId),
        ),
      )
      .limit(1)
    if (existing) {
      await tx
        .update(trainingLessonProgress)
        .set({ status: 'completed', completedAt: now })
        .where(eq(trainingLessonProgress.id, existing.id))
    } else {
      await tx.insert(trainingLessonProgress).values({
        tenantId,
        enrollmentId,
        lessonId,
        personId,
        status: 'completed',
        startedAt: now,
        completedAt: now,
      })
    }

    // Recompute progress across all lessons; finish (record + certificate) if
    // every required one is done. Shared with the evaluator sign-off path.
    const summary = await recomputeEnrollmentCompletion(tx, {
      tenantId,
      enrollmentId,
      courseId: enr.courseId,
      personId,
      currentLessonId: lessonId,
    })
    return { courseId: enr.courseId, ...summary }
  })

  if (result.completed) {
    await recordAudit(ctx, {
      entityType: 'training_enrollment',
      entityId: enrollmentId,
      action: 'sign',
      summary: `Completed course — issued record ${result.recordId}`,
      after: { recordId: result.recordId, certificateId: result.certificateId },
    })
  }
  revalidatePath(`/training/learn/${result.courseId}`)
  revalidatePath('/training/learn')
}

// Start a quiz attempt for a lesson, reusing the existing native assessment
// engine, then hand off to the existing attempt page. Returning to the player
// and clicking "Mark complete" verifies the pass.
export async function startLessonQuiz(enrollmentId: string, lessonId: string) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId = ctx.tenantId
  const personId = await resolvePersonId(ctx)

  const attemptId = await ctx.db(async (tx) => {
    // Ownership: the attempt + lesson-progress rows are written against this
    // enrollment, so confirm it belongs to the caller before touching it (mirrors
    // markLessonComplete). Without this any tenant user could spawn an attempt on
    // and mutate someone else's enrollment progress.
    const [enr] = await tx
      .select({ personId: trainingEnrollments.personId })
      .from(trainingEnrollments)
      .where(eq(trainingEnrollments.id, enrollmentId))
      .limit(1)
    if (!enr) throw new Error('Enrollment not found')
    if (enr.personId !== personId) throw new Error('That enrollment is not yours')

    const [lesson] = await tx
      .select()
      .from(trainingLessons)
      .where(eq(trainingLessons.id, lessonId))
      .limit(1)
    if (!lesson || !lesson.assessmentTypeId) throw new Error('This lesson has no quiz configured.')
    const [type] = await tx
      .select()
      .from(trainingAssessmentTypes)
      .where(eq(trainingAssessmentTypes.id, lesson.assessmentTypeId))
      .limit(1)
    if (!type) throw new Error('Assessment type not found')

    const questions = await tx
      .select()
      .from(trainingAssessmentTypeQuestions)
      .where(eq(trainingAssessmentTypeQuestions.typeId, type.id))
      .orderBy(asc(trainingAssessmentTypeQuestions.entityOrder))
    const pointsPossible = questions.reduce((s, q) => s + (q.points ?? 1), 0)

    const [attempt] = await tx
      .insert(trainingAssessments)
      .values({
        tenantId,
        typeId: type.id,
        personId,
        courseId: type.courseId,
        passingScore: type.passingScore,
        pointsPossible,
        status: 'in_progress',
      })
      .returning()
    if (!attempt) throw new Error('Failed to start quiz')

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

    const [existing] = await tx
      .select()
      .from(trainingLessonProgress)
      .where(
        and(
          eq(trainingLessonProgress.enrollmentId, enrollmentId),
          eq(trainingLessonProgress.lessonId, lessonId),
        ),
      )
      .limit(1)
    if (existing) {
      await tx
        .update(trainingLessonProgress)
        .set({
          status: 'in_progress',
          assessmentId: attempt.id,
          startedAt: existing.startedAt ?? new Date(),
          attempts: (existing.attempts ?? 0) + 1,
        })
        .where(eq(trainingLessonProgress.id, existing.id))
    } else {
      await tx.insert(trainingLessonProgress).values({
        tenantId,
        enrollmentId,
        lessonId,
        personId,
        status: 'in_progress',
        assessmentId: attempt.id,
        startedAt: new Date(),
        attempts: 1,
      })
    }
    return attempt.id
  })

  redirect(`/training/assessments/${attemptId}`)
}
