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
import { randomBytes } from 'node:crypto'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import type { RequestContext } from '@beaconhs/tenant'
import {
  people,
  trainingAssessmentResults,
  trainingAssessmentTypeQuestions,
  trainingAssessmentTypes,
  trainingAssessments,
  trainingCertificates,
  trainingCourses,
  trainingEnrollments,
  trainingLessonProgress,
  trainingLessons,
  trainingRecords,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

// Resolve the signed-in user's People record (workers without an app login have
// no people.user_id, so an explicit personId must be passed for those).
async function resolvePersonId(ctx: RequestContext): Promise<string> {
  const id = await ctx.db(async (tx) => {
    const [p] = await tx
      .select({ id: people.id })
      .from(people)
      .where(eq(people.userId, ctx.userId))
      .limit(1)
    return p?.id ?? null
  })
  if (!id) {
    throw new Error(
      'No worker profile is linked to your account — ask an admin to link your People record.',
    )
  }
  return id
}

export async function enrollInCourse(courseId: string, personIdArg?: string) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId = ctx.tenantId
  const assigning = Boolean(personIdArg && personIdArg.trim())
  const personId = assigning ? personIdArg!.trim() : await resolvePersonId(ctx)

  await ctx.db(async (tx) => {
    const [existing] = await tx
      .select()
      .from(trainingEnrollments)
      .where(
        and(
          eq(trainingEnrollments.courseId, courseId),
          eq(trainingEnrollments.personId, personId),
        ),
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
      assignedByTenantUserId: assigning ? ctx.membership?.id ?? null : null,
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

    // Recompute progress across all lessons; finish if every required one is done.
    const lessons = await tx
      .select()
      .from(trainingLessons)
      .where(and(eq(trainingLessons.courseId, enr.courseId), isNull(trainingLessons.deletedAt)))
    const progressRows = await tx
      .select()
      .from(trainingLessonProgress)
      .where(eq(trainingLessonProgress.enrollmentId, enrollmentId))
    const completedIds = new Set(
      progressRows.filter((p) => p.status === 'completed').map((p) => p.lessonId),
    )
    completedIds.add(lessonId)
    const total = lessons.length || 1
    const completedCount = lessons.filter((l) => completedIds.has(l.id)).length
    const percent = Math.round((completedCount / total) * 100)
    const required = lessons.filter((l) => l.isRequired)
    const allRequiredDone = required.length > 0 && required.every((l) => completedIds.has(l.id))

    if (allRequiredDone && enr.status !== 'completed') {
      const [course] = await tx
        .select()
        .from(trainingCourses)
        .where(eq(trainingCourses.id, enr.courseId))
        .limit(1)
      const completedOn = new Date().toISOString().slice(0, 10)
      const expiresOn = course?.validForMonths
        ? new Date(Date.now() + course.validForMonths * 30 * 86_400_000).toISOString().slice(0, 10)
        : null
      const [rec] = await tx
        .insert(trainingRecords)
        .values({
          tenantId,
          personId,
          courseId: enr.courseId,
          source: 'self_paced',
          completedOn,
          expiresOn,
          instructor: 'Self-paced course',
          details: `Completed via the learning player (enrollment ${enrollmentId})`,
          certificateType: 'auto',
        })
        .returning()
      let certificateId: string | null = null
      if (rec) {
        const [cert] = await tx
          .insert(trainingCertificates)
          .values({ tenantId, recordId: rec.id, verifyToken: randomBytes(20).toString('hex') })
          .returning()
        certificateId = cert?.id ?? null
      }
      await tx
        .update(trainingEnrollments)
        .set({
          status: 'completed',
          completedAt: now,
          progressPercent: 100,
          currentLessonId: lessonId,
          recordId: rec?.id ?? null,
        })
        .where(eq(trainingEnrollments.id, enrollmentId))
      return {
        courseId: enr.courseId,
        completed: true,
        percent: 100,
        recordId: rec?.id ?? null,
        certificateId,
      }
    }

    await tx
      .update(trainingEnrollments)
      .set({ status: 'in_progress', progressPercent: percent, currentLessonId: lessonId })
      .where(eq(trainingEnrollments.id, enrollmentId))
    return { courseId: enr.courseId, completed: false, percent, recordId: null, certificateId: null }
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
