// Shared enrollment-completion math — used by the learner's markLessonComplete
// AND the evaluator's practical sign-off. Recomputes progress % from the
// course's live lesson list; when every required lesson is complete it writes
// the training_records row (expiry from course.validForMonths), mints the
// certificate (+ verify token), and flips the enrollment to completed.

import { randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  trainingCertificates,
  trainingCourses,
  trainingEnrollments,
  trainingLessonProgress,
  trainingLessons,
  trainingRecords,
} from '@beaconhs/db/schema'

export type CompletionResult = {
  completed: boolean
  percent: number
  recordId: string | null
  certificateId: string | null
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
  const now = new Date()

  if (allRequiredDone && enr.status !== 'completed') {
    const [course] = await tx
      .select()
      .from(trainingCourses)
      .where(eq(trainingCourses.id, courseId))
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
        courseId,
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
        ...(currentLessonId ? { currentLessonId } : {}),
        recordId: rec?.id ?? null,
      })
      .where(eq(trainingEnrollments.id, enrollmentId))
    return { completed: true, percent: 100, recordId: rec?.id ?? null, certificateId }
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
