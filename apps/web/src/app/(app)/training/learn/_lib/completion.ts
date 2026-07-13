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
import { issueTrainingCertificate } from '@/lib/training-certificate-issuance'
import { addMonthsIso } from '../../_lib/dates'
import { deliveryMeta } from '../../_lib/delivery'

type CompletionResult = {
  completed: boolean
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
  },
): Promise<{ recordId: string | null; certificateId: string | null }> {
  const { tenantId, enrollmentId, courseId, personId, instructor, details, currentLessonId } = args
  const now = new Date()
  const [course] = await tx
    .select()
    .from(trainingCourses)
    .where(eq(trainingCourses.id, courseId))
    .limit(1)
  const completedOn = now.toISOString().slice(0, 10)
  const expiresOn = course?.validForMonths ? addMonthsIso(completedOn, course.validForMonths) : null
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
  let certificateId: string | null = null
  if (rec) {
    const cert = await issueTrainingCertificate(tx, { tenantId, recordId: rec.id })
    certificateId = cert.id
  }
  await tx
    .update(trainingEnrollments)
    .set({
      status: 'completed',
      completedAt: now,
      progressPercent: 100,
      ...(currentLessonId ? { currentLessonId } : {}),
      recordId: rec?.id ?? null,
    })
    .where(eq(trainingEnrollments.id, enrollmentId))
  return { recordId: rec?.id ?? null, certificateId }
}

// Self-directed completion for `online` courses: there are no lessons to track,
// so the learner self-attests after finishing the externally linked course. The
// enrollment-ownership check lives in the calling server action.
export async function completeOnlineEnrollment(
  tx: Database,
  args: { tenantId: string; enrollmentId: string; courseId: string; personId: string },
): Promise<CompletionResult> {
  const [enr] = await tx
    .select()
    .from(trainingEnrollments)
    .where(eq(trainingEnrollments.id, args.enrollmentId))
    .limit(1)
  if (!enr) throw new Error('Enrollment not found')
  if (enr.status === 'completed') {
    return { completed: true, percent: 100, recordId: enr.recordId ?? null, certificateId: null }
  }
  const { recordId, certificateId } = await issueCourseRecordAndComplete(tx, {
    tenantId: args.tenantId,
    enrollmentId: args.enrollmentId,
    courseId: args.courseId,
    personId: args.personId,
    instructor: 'Online course',
    details: `Completed online course (enrollment ${args.enrollmentId})`,
  })
  return { completed: true, percent: 100, recordId, certificateId }
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
  if (!enr) throw new Error('Enrollment not found')

  const [course] = await tx
    .select({ deliveryType: trainingCourses.deliveryType })
    .from(trainingCourses)
    .where(eq(trainingCourses.id, courseId))
    .limit(1)
  // Classroom (instructor issues records at class completion) and external
  // certificate (manual entry) never mint a record from the enrollment path —
  // finishing the content just marks the enrollment complete.
  const autoIssues = course ? deliveryMeta(course.deliveryType).autoIssuesRecord : false

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

  if (allRequiredDone && enr.status !== 'completed') {
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
      return { completed: true, percent: 100, recordId, certificateId }
    }
    // Content finished, but the record is issued elsewhere (instructor at class
    // completion). Mark the enrollment complete without a record/certificate.
    await tx
      .update(trainingEnrollments)
      .set({
        status: 'completed',
        completedAt: new Date(),
        progressPercent: 100,
        ...(currentLessonId ? { currentLessonId } : {}),
      })
      .where(eq(trainingEnrollments.id, enrollmentId))
    return { completed: true, percent: 100, recordId: null, certificateId: null }
  }

  await tx
    .update(trainingEnrollments)
    .set({
      status: enr.status === 'completed' ? 'completed' : 'in_progress',
      progressPercent: percent,
      ...(currentLessonId ? { currentLessonId } : {}),
    })
    .where(eq(trainingEnrollments.id, enrollmentId))
  return { completed: false, percent, recordId: null, certificateId: null }
}
