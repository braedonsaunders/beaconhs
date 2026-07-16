// Shared enrollment-completion math — used by the learner's markLessonComplete
// AND the evaluator's practical sign-off. Recomputes progress % from the
// course's live lesson list; when every required lesson is complete it writes
// the training_records row (expiry from course.validForMonths), mints the
// certificate (+ verify token), and flips the enrollment to completed.

import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  trainingCourses,
  trainingEnrollments,
  trainingLessonProgress,
  trainingLessons,
  trainingRecords,
} from '@beaconhs/db/schema'
import { materializeEvidenceTargetObligations } from '@beaconhs/compliance'
import { issueTrainingCertificate } from '@/lib/training-certificate-issuance'
import { assertTrainingEnrollmentOpen } from '@/lib/training-mutation-validation'
import { addMonthsIso } from '../../_lib/dates'
import { deliveryMeta } from '../../_lib/delivery'

type CompletionResult = {
  completed: boolean
  newlyCompleted: boolean
  percent: number
  recordId: string | null
  certificateId: string | null
}

// Write the training_records row (expiry from course.validForMonths), mint the
// certificate (+ verify token), and flip the enrollment to completed. Shared by
// the lesson-based completion path and the self-directed online path.
async function issueCourseRecordAndComplete(
  tx: Database,
  args: {
    tenantId: string
    enrollmentId: string
    courseId: string
    personId: string
    instructor: string
    details: string
    currentLessonId?: string
    completionReview?: {
      reviewedAt: Date
      reviewerTenantUserId: string
      note: string | null
    }
  },
): Promise<{ recordId: string; certificateId: string }> {
  const {
    tenantId,
    enrollmentId,
    courseId,
    personId,
    instructor,
    details,
    currentLessonId,
    completionReview,
  } = args
  const now = new Date()
  const [course] = await tx
    .select()
    .from(trainingCourses)
    .where(and(eq(trainingCourses.id, courseId), isNull(trainingCourses.deletedAt)))
    .limit(1)
  if (!course) throw new Error('Course not found')
  const completedOn = now.toISOString().slice(0, 10)
  const expiresOn = course.validForMonths ? addMonthsIso(completedOn, course.validForMonths) : null
  const [rec] = await tx
    .insert(trainingRecords)
    .values({
      tenantId,
      personId,
      courseId,
      source: 'self_paced',
      completedOn,
      expiresOn,
      instructor,
      details,
      certificateType: 'auto',
    })
    .returning()
  if (!rec) throw new Error('Could not issue the training record.')
  const cert = await issueTrainingCertificate(tx, { tenantId, recordId: rec.id })
  const [completedEnrollment] = await tx
    .update(trainingEnrollments)
    .set({
      status: 'completed',
      completedAt: now,
      progressPercent: 100,
      ...(currentLessonId ? { currentLessonId } : {}),
      ...(completionReview
        ? {
            completionReviewedAt: completionReview.reviewedAt,
            completionReviewedByTenantUserId: completionReview.reviewerTenantUserId,
            completionReviewNote: completionReview.note,
          }
        : {}),
      recordId: rec.id,
    })
    .where(
      and(
        eq(trainingEnrollments.id, enrollmentId),
        eq(trainingEnrollments.courseId, courseId),
        eq(trainingEnrollments.personId, personId),
        eq(trainingEnrollments.status, 'in_progress'),
        isNull(trainingEnrollments.deletedAt),
      ),
    )
    .returning({ id: trainingEnrollments.id })
  if (!completedEnrollment) throw new Error('Enrollment is not active.')
  await materializeEvidenceTargetObligations(tx, tenantId, {
    sourceModule: 'training',
    targetRef: { courseId },
  })
  return { recordId: rec.id, certificateId: cert.id }
}

// Staff-verified completion for an `online` course. The calling action verifies
// the training permission, provider-completion request, and course delivery
// type before this shared record/certificate transaction runs.
export async function completeVerifiedOnlineEnrollment(
  tx: Database,
  args: {
    tenantId: string
    enrollmentId: string
    courseId: string
    personId: string
    reviewerTenantUserId: string
    reviewNote: string | null
  },
): Promise<CompletionResult> {
  const [enr] = await tx
    .select()
    .from(trainingEnrollments)
    .where(eq(trainingEnrollments.id, args.enrollmentId))
    .limit(1)
    .for('update')
  if (!enr) throw new Error('Enrollment not found')
  if (enr.courseId !== args.courseId || enr.personId !== args.personId) {
    throw new Error('Enrollment not found')
  }
  if (enr.status === 'completed') {
    return {
      completed: true,
      newlyCompleted: false,
      percent: 100,
      recordId: enr.recordId ?? null,
      certificateId: null,
    }
  }
  assertTrainingEnrollmentOpen(enr.status)
  const { recordId, certificateId } = await issueCourseRecordAndComplete(tx, {
    tenantId: args.tenantId,
    enrollmentId: args.enrollmentId,
    courseId: args.courseId,
    personId: args.personId,
    instructor: 'Online course',
    details: `Online provider completion verified by training staff (enrollment ${args.enrollmentId})`,
    completionReview: {
      reviewedAt: new Date(),
      reviewerTenantUserId: args.reviewerTenantUserId,
      note: args.reviewNote,
    },
  })
  return { completed: true, newlyCompleted: true, percent: 100, recordId, certificateId }
}

export async function recomputeEnrollmentCompletion(
  tx: Database,
  args: {
    tenantId: string
    enrollmentId: string
    courseId: string
    personId: string
    currentLessonId?: string
  },
): Promise<CompletionResult> {
  const { tenantId, enrollmentId, courseId, personId, currentLessonId } = args

  const [enr] = await tx
    .select()
    .from(trainingEnrollments)
    .where(eq(trainingEnrollments.id, enrollmentId))
    .limit(1)
    .for('update')
  if (!enr) throw new Error('Enrollment not found')
  if (enr.courseId !== courseId || enr.personId !== personId) {
    throw new Error('Enrollment not found')
  }
  if (enr.status === 'completed') {
    return {
      completed: true,
      newlyCompleted: false,
      percent: 100,
      recordId: enr.recordId ?? null,
      certificateId: null,
    }
  }
  assertTrainingEnrollmentOpen(enr.status)

  const [course] = await tx
    .select({ deliveryType: trainingCourses.deliveryType })
    .from(trainingCourses)
    .where(and(eq(trainingCourses.id, courseId), isNull(trainingCourses.deletedAt)))
    .limit(1)
  if (!course) throw new Error('Course not found')
  // Classroom (instructor issues records at class completion) and external
  // certificate (manual entry) never mint a record from the enrollment path —
  // finishing the content just marks the enrollment complete.
  const autoIssues = deliveryMeta(course.deliveryType).autoIssuesRecord

  const lessons = await tx
    .select()
    .from(trainingLessons)
    .where(and(eq(trainingLessons.courseId, courseId), isNull(trainingLessons.deletedAt)))
  const progressRows = await tx
    .select()
    .from(trainingLessonProgress)
    .where(eq(trainingLessonProgress.enrollmentId, enrollmentId))
  const completedIds = new Set(
    progressRows.filter((p) => p.status === 'completed').map((p) => p.lessonId),
  )

  const total = lessons.length || 1
  const completedCount = lessons.filter((l) => completedIds.has(l.id)).length
  const percent = Math.round((completedCount / total) * 100)
  const required = lessons.filter((l) => l.isRequired)
  const allRequiredDone = required.length > 0 && required.every((l) => completedIds.has(l.id))

  if (allRequiredDone) {
    if (autoIssues) {
      const { recordId, certificateId } = await issueCourseRecordAndComplete(tx, {
        tenantId,
        enrollmentId,
        courseId,
        personId,
        instructor: 'Self-paced course',
        details: `Completed via the learning player (enrollment ${enrollmentId})`,
        currentLessonId,
      })
      return {
        completed: true,
        newlyCompleted: true,
        percent: 100,
        recordId,
        certificateId,
      }
    }
    // Content finished, but the record is issued elsewhere (instructor at class
    // completion). Mark the enrollment complete without a record/certificate.
    const [completedEnrollment] = await tx
      .update(trainingEnrollments)
      .set({
        status: 'completed',
        completedAt: new Date(),
        progressPercent: 100,
        ...(currentLessonId ? { currentLessonId } : {}),
      })
      .where(
        and(
          eq(trainingEnrollments.id, enrollmentId),
          eq(trainingEnrollments.courseId, courseId),
          eq(trainingEnrollments.personId, personId),
          eq(trainingEnrollments.status, 'in_progress'),
          isNull(trainingEnrollments.deletedAt),
        ),
      )
      .returning({ id: trainingEnrollments.id })
    if (!completedEnrollment) throw new Error('Enrollment is not active.')
    await materializeEvidenceTargetObligations(tx, tenantId, {
      sourceModule: 'training',
      targetRef: { courseId },
    })
    return {
      completed: true,
      newlyCompleted: true,
      percent: 100,
      recordId: null,
      certificateId: null,
    }
  }

  const [updatedEnrollment] = await tx
    .update(trainingEnrollments)
    .set({
      status: 'in_progress',
      progressPercent: percent,
      ...(currentLessonId ? { currentLessonId } : {}),
    })
    .where(
      and(
        eq(trainingEnrollments.id, enrollmentId),
        eq(trainingEnrollments.courseId, courseId),
        eq(trainingEnrollments.personId, personId),
        eq(trainingEnrollments.status, 'in_progress'),
        isNull(trainingEnrollments.deletedAt),
      ),
    )
    .returning({ id: trainingEnrollments.id })
  if (!updatedEnrollment) throw new Error('Enrollment is not active.')
  return {
    completed: false,
    newlyCompleted: false,
    percent,
    recordId: null,
    certificateId: null,
  }
}
