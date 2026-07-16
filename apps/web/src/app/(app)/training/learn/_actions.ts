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
import { and, eq, isNull } from 'drizzle-orm'
import { can, type RequestContext } from '@beaconhs/tenant'
import { materializeEvidenceTargetObligations } from '@beaconhs/compliance'
import {
  people,
  trainingAssessments,
  trainingCourses,
  trainingEnrollments,
  trainingLessonProgress,
  trainingLessons,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit, recordAuditInTransaction } from '@/lib/audit'
import {
  assertLessonCourse,
  minimumTimeRemainingSeconds,
  requireTrainingUuid,
} from '@/lib/training-mutation-validation'
import { deliveryMeta } from '../_lib/delivery'
import { createAssessmentAttempt } from '../_lib/assessment-attempts'
import { recomputeEnrollmentCompletion } from './_lib/completion'
import {
  findOutstandingCourseRequirement,
  shouldRestartEnrollment,
} from './_lib/compliance-requirement'
import { requireOpenTrainingEnrollment } from './_lib/enrollment'

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
  courseId = requireTrainingUuid(courseId, 'Course')

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
    personIdArg = requireTrainingUuid(requested, 'Person')
    const ownPersonId = await resolveMyPersonId(ctx)
    assigning = personIdArg !== ownPersonId
    if (assigning && !canAssignTraining(ctx)) {
      throw new Error('You do not have permission to assign training to other people.')
    }
    personId = personIdArg
  }

  await ctx.db(async (tx) => {
    // Enrollment only makes sense for courses a learner can take or attend.
    // External certificates are records entered by training staff, and
    // classroom / on-the-job courses are assigned by staff, not self-started.
    const [course] = await tx
      .select({ deliveryType: trainingCourses.deliveryType })
      .from(trainingCourses)
      .where(and(eq(trainingCourses.id, courseId), isNull(trainingCourses.deletedAt)))
      .limit(1)
    if (!course) throw new Error('Course not found')
    const meta = deliveryMeta(course.deliveryType)
    if (!meta.hasContent && !meta.selfLaunch) {
      throw new Error(
        'This course tracks external certificates — add a training record instead of enrolling.',
      )
    }
    if (!assigning && !meta.selfLaunch) {
      throw new Error('This course is assigned by your training team — it cannot be self-started.')
    }

    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(eq(people.id, personId))
      .limit(1)
    if (!person) throw new Error('Person not found')

    const requirement = await findOutstandingCourseRequirement(tx, {
      tenantId,
      personId,
      courseId,
    })
    const source = assigning ? 'assigned' : requirement ? 'compliance' : 'self'

    const [existing] = await tx
      .select()
      .from(trainingEnrollments)
      .where(
        and(eq(trainingEnrollments.courseId, courseId), eq(trainingEnrollments.personId, personId)),
      )
      .limit(1)
    if (existing) {
      if (shouldRestartEnrollment(existing, { assigning, requirement })) {
        await tx
          .delete(trainingLessonProgress)
          .where(eq(trainingLessonProgress.enrollmentId, existing.id))
        const [restarted] = await tx
          .update(trainingEnrollments)
          .set({
            status: 'in_progress',
            source,
            assignedByTenantUserId: assigning ? (ctx.membership?.id ?? null) : null,
            progressPercent: 0,
            currentLessonId: null,
            startedAt: new Date(),
            completedAt: null,
            completionRequestedAt: null,
            completionReviewedAt: null,
            completionReviewedByTenantUserId: null,
            completionReviewNote: null,
            dueOn: requirement?.dueOn ?? null,
            expiresOn: null,
            recordId: null,
            deletedAt: null,
          })
          .where(eq(trainingEnrollments.id, existing.id))
          .returning({ id: trainingEnrollments.id })
        if (!restarted) throw new Error('Could not restart the enrollment.')
        await recordAuditInTransaction(tx, ctx, {
          entityType: 'training_enrollment',
          entityId: restarted.id,
          action: 'update',
          summary: 'Restarted course enrollment',
          after: { courseId, personId, source },
        })
        await materializeEvidenceTargetObligations(tx, tenantId, {
          sourceModule: 'training',
          targetRef: { courseId },
        })
        return { id: restarted.id, changed: true, restarted: true, source }
      }
      return { id: existing.id, changed: false, restarted: false, source: existing.source }
    }
    const [created] = await tx
      .insert(trainingEnrollments)
      .values({
        tenantId,
        courseId,
        personId,
        status: 'in_progress',
        source,
        assignedByTenantUserId: assigning ? (ctx.membership?.id ?? null) : null,
        dueOn: requirement?.dueOn ?? null,
        startedAt: new Date(),
      })
      .returning({ id: trainingEnrollments.id })
    if (!created) throw new Error('Could not create the enrollment.')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_enrollment',
      entityId: created.id,
      action: 'create',
      summary: 'Started course enrollment',
      after: { courseId, personId, source },
    })
    await materializeEvidenceTargetObligations(tx, tenantId, {
      sourceModule: 'training',
      targetRef: { courseId },
    })
    return { id: created.id, changed: true, restarted: false, source }
  })
  revalidatePath(`/training/learn/${courseId}`)
  revalidatePath('/training/learn')
  revalidatePath('/my/training')
  revalidatePath('/compliance/mine')
}

// Online providers are external to BeaconHS, so a learner can only submit a
// verification request. Training staff issue the record/certificate later from
// the course completions screen after checking the provider result.
export async function requestOnlineCourseCompletion(enrollmentId: string) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  const personId = await resolvePersonId(ctx)
  enrollmentId = requireTrainingUuid(enrollmentId, 'Enrollment')

  const result = await ctx.db(async (tx) => {
    const enrollment = await requireOpenTrainingEnrollment(tx, {
      enrollmentId,
      expectedPersonId: personId,
    })
    if (enrollment.deliveryType !== 'online') {
      throw new Error('This course is not an online course.')
    }

    if (enrollment.completionRequestedAt) {
      return { courseId: enrollment.courseId, requestedAt: enrollment.completionRequestedAt }
    }
    const requestedAt = new Date()
    const [updated] = await tx
      .update(trainingEnrollments)
      .set({
        completionRequestedAt: requestedAt,
        completionReviewedAt: null,
        completionReviewedByTenantUserId: null,
        completionReviewNote: null,
        progressPercent: 100,
      })
      .where(
        and(
          eq(trainingEnrollments.id, enrollmentId),
          eq(trainingEnrollments.personId, personId),
          eq(trainingEnrollments.status, 'in_progress'),
          isNull(trainingEnrollments.deletedAt),
        ),
      )
      .returning({ id: trainingEnrollments.id })
    if (!updated) throw new Error('Enrollment is no longer open.')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_enrollment',
      entityId: enrollmentId,
      action: 'update',
      summary: 'Submitted online course completion for verification',
      after: { completionRequestedAt: requestedAt },
      dedupKey: `training.online-completion-requested:${enrollmentId}:${requestedAt.toISOString()}`,
    })
    return { courseId: enrollment.courseId, requestedAt }
  })
  revalidatePath(`/training/learn/${result.courseId}`)
  revalidatePath('/training/learn')
  revalidatePath('/my/training')
}

// Stamp a server-authoritative start time when a learner opens a lesson. The
// minimum-time completion rule uses this persisted timestamp; browser clocks
// and caller-supplied elapsed values are never trusted.
export async function startLesson(enrollmentId: string, lessonId: string) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId = ctx.tenantId
  const personId = await resolvePersonId(ctx)
  enrollmentId = requireTrainingUuid(enrollmentId, 'Enrollment')
  lessonId = requireTrainingUuid(lessonId, 'Lesson')

  const result = await ctx.db(async (tx) => {
    const enrollment = await requireOpenTrainingEnrollment(tx, {
      enrollmentId,
      expectedPersonId: personId,
    })

    const [lesson] = await tx
      .select({ courseId: trainingLessons.courseId })
      .from(trainingLessons)
      .where(and(eq(trainingLessons.id, lessonId), isNull(trainingLessons.deletedAt)))
      .limit(1)
    if (!lesson) throw new Error('Lesson not found')
    assertLessonCourse(enrollment.courseId, lesson.courseId)

    const [existing] = await tx
      .select({
        id: trainingLessonProgress.id,
        personId: trainingLessonProgress.personId,
        status: trainingLessonProgress.status,
        startedAt: trainingLessonProgress.startedAt,
      })
      .from(trainingLessonProgress)
      .where(
        and(
          eq(trainingLessonProgress.enrollmentId, enrollmentId),
          eq(trainingLessonProgress.lessonId, lessonId),
        ),
      )
      .limit(1)
    if (existing && existing.personId !== personId) {
      throw new Error('Lesson progress does not belong to this learner.')
    }
    if (existing?.status === 'completed' || existing?.startedAt) {
      return { id: existing.id, courseId: enrollment.courseId, changed: false }
    }

    const now = new Date()
    if (existing) {
      const [updated] = await tx
        .update(trainingLessonProgress)
        .set({ status: 'in_progress', startedAt: now })
        .where(eq(trainingLessonProgress.id, existing.id))
        .returning({ id: trainingLessonProgress.id })
      if (!updated) throw new Error('Could not start the lesson.')
      return { id: updated.id, courseId: enrollment.courseId, changed: true }
    }
    const [created] = await tx
      .insert(trainingLessonProgress)
      .values({
        tenantId,
        enrollmentId,
        lessonId,
        personId,
        status: 'in_progress',
        startedAt: now,
      })
      .returning({ id: trainingLessonProgress.id })
    if (!created) throw new Error('Could not start the lesson.')
    return { id: created.id, courseId: enrollment.courseId, changed: true }
  })

  if (result.changed) {
    await recordAudit(ctx, {
      entityType: 'training_lesson_progress',
      entityId: result.id,
      action: 'create',
      summary: 'Started lesson',
      after: { enrollmentId, lessonId },
    })
  }
  revalidatePath(`/training/learn/${result.courseId}`)
}

export async function markLessonComplete(enrollmentId: string, lessonId: string) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId = ctx.tenantId
  const personId = await resolvePersonId(ctx)
  enrollmentId = requireTrainingUuid(enrollmentId, 'Enrollment')
  lessonId = requireTrainingUuid(lessonId, 'Lesson')

  const result = await ctx.db(async (tx) => {
    const enrollment = await requireOpenTrainingEnrollment(tx, {
      enrollmentId,
      expectedPersonId: personId,
    })

    const [lesson] = await tx
      .select()
      .from(trainingLessons)
      .where(and(eq(trainingLessons.id, lessonId), isNull(trainingLessons.deletedAt)))
      .limit(1)
    if (!lesson) throw new Error('Lesson not found')
    assertLessonCourse(enrollment.courseId, lesson.courseId)

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
    if (existing && existing.personId !== personId) {
      throw new Error('Lesson progress does not belong to this learner.')
    }
    if (existing?.status === 'completed') throw new Error('Lesson is already complete.')

    // Practical lessons can never be self-completed.
    if (lesson.completionRule === 'evaluator') {
      throw new Error('This lesson requires an evaluator sign-off.')
    }

    // Quiz lessons that gate on a pass require a passed attempt first.
    if (lesson.kind === 'quiz' && lesson.completionRule === 'pass') {
      if (!lesson.assessmentTypeId) throw new Error('This quiz has no assessment configured.')
      if (!existing?.assessmentId) throw new Error('Start and pass this lesson quiz first.')
      const [passedAttempt] = await tx
        .select({ id: trainingAssessments.id })
        .from(trainingAssessments)
        .where(
          and(
            eq(trainingAssessments.id, existing.assessmentId),
            eq(trainingAssessments.personId, personId),
            eq(trainingAssessments.typeId, lesson.assessmentTypeId),
            eq(trainingAssessments.passed, true),
          ),
        )
        .limit(1)
      if (!passedAttempt) throw new Error('Pass the quiz before completing this lesson.')
    }

    const now = new Date()
    const elapsedSeconds = existing?.startedAt
      ? Math.max(0, Math.floor((now.getTime() - existing.startedAt.getTime()) / 1_000))
      : 0
    if (lesson.completionRule === 'min_time') {
      if (!lesson.minTimeSeconds || lesson.minTimeSeconds < 1) {
        throw new Error('This lesson has an invalid minimum-time configuration.')
      }
      const remaining = minimumTimeRemainingSeconds(
        existing?.startedAt ?? null,
        lesson.minTimeSeconds,
        now,
      )
      if (remaining > 0) {
        const minutes = Math.ceil(remaining / 60)
        throw new Error(
          `Spend at least ${minutes} more minute${minutes === 1 ? '' : 's'} in this lesson.`,
        )
      }
    }
    let progressId: string
    if (existing) {
      const [updated] = await tx
        .update(trainingLessonProgress)
        .set({
          status: 'completed',
          completedAt: now,
          timeSpentSeconds: Math.max(existing.timeSpentSeconds ?? 0, elapsedSeconds),
        })
        .where(eq(trainingLessonProgress.id, existing.id))
        .returning({ id: trainingLessonProgress.id })
      if (!updated) throw new Error('Could not complete the lesson.')
      progressId = existing.id
    } else {
      const [created] = await tx
        .insert(trainingLessonProgress)
        .values({
          tenantId,
          enrollmentId,
          lessonId,
          personId,
          status: 'completed',
          startedAt: now,
          completedAt: now,
        })
        .returning({ id: trainingLessonProgress.id })
      if (!created) throw new Error('Could not complete the lesson.')
      progressId = created.id
    }

    // Recompute progress across all lessons; finish (record + certificate) if
    // every required one is done. Shared with the evaluator sign-off path.
    const summary = await recomputeEnrollmentCompletion(tx, {
      tenantId,
      enrollmentId,
      courseId: enrollment.courseId,
      personId,
      currentLessonId: lessonId,
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_lesson_progress',
      entityId: progressId,
      action: 'sign',
      summary: 'Completed lesson',
      after: { enrollmentId, lessonId },
    })
    if (summary.newlyCompleted) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'training_enrollment',
        entityId: enrollmentId,
        action: 'sign',
        summary: summary.recordId
          ? `Completed course — issued record ${summary.recordId}`
          : 'Completed course content — record issued separately at class completion',
        after: { recordId: summary.recordId, certificateId: summary.certificateId },
      })
    }
    return { courseId: enrollment.courseId, progressId, ...summary }
  })
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
  enrollmentId = requireTrainingUuid(enrollmentId, 'Enrollment')
  lessonId = requireTrainingUuid(lessonId, 'Lesson')

  const attemptId = await ctx.db(async (tx) => {
    // Ownership: the attempt + lesson-progress rows are written against this
    // enrollment, so confirm it belongs to the caller before touching it (mirrors
    // markLessonComplete). Without this any tenant user could spawn an attempt on
    // and mutate someone else's enrollment progress.
    const enrollment = await requireOpenTrainingEnrollment(tx, {
      enrollmentId,
      expectedPersonId: personId,
    })

    const [lesson] = await tx
      .select()
      .from(trainingLessons)
      .where(and(eq(trainingLessons.id, lessonId), isNull(trainingLessons.deletedAt)))
      .limit(1)
    if (!lesson) throw new Error('Lesson not found')
    assertLessonCourse(enrollment.courseId, lesson.courseId)
    if (lesson.kind !== 'quiz' || !lesson.assessmentTypeId) {
      throw new Error('This lesson has no quiz configured.')
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
    if (existing && existing.personId !== personId) {
      throw new Error('Lesson progress does not belong to this learner.')
    }
    if (existing?.status === 'completed') throw new Error('Lesson is already complete.')

    // Shared creation path (also used by the proctor "New attempt" flow).
    // Soft-deleted types are rejected; the catalogue `active` flag is not
    // required here — a type hidden from the catalogue keeps working for the
    // lessons still wired to it.
    const { attempt } = await createAssessmentAttempt(tx, {
      tenantId,
      typeId: lesson.assessmentTypeId,
      personId,
      source: 'lesson_quiz',
    })

    if (existing) {
      const [updated] = await tx
        .update(trainingLessonProgress)
        .set({
          status: 'in_progress',
          assessmentId: attempt.id,
          startedAt: existing.startedAt ?? new Date(),
          attempts: (existing.attempts ?? 0) + 1,
        })
        .where(eq(trainingLessonProgress.id, existing.id))
        .returning({ id: trainingLessonProgress.id })
      if (!updated) throw new Error('Could not start the quiz.')
    } else {
      const [created] = await tx
        .insert(trainingLessonProgress)
        .values({
          tenantId,
          enrollmentId,
          lessonId,
          personId,
          status: 'in_progress',
          assessmentId: attempt.id,
          startedAt: new Date(),
          attempts: 1,
        })
        .returning({ id: trainingLessonProgress.id })
      if (!created) throw new Error('Could not start the quiz.')
    }
    return attempt.id
  })

  await recordAudit(ctx, {
    entityType: 'training_assessment',
    entityId: attemptId,
    action: 'create',
    summary: `Started lesson quiz attempt ${attemptId}`,
    after: { enrollmentId, lessonId },
  })
  redirect(`/training/assessments/${attemptId}`)
}
