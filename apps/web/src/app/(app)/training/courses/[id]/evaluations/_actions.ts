'use server'

// Practical-test sign-off. Training managers evaluate a learner against the
// lesson's criteria, capture a signature, and pass/fail them. A pass completes
// the lesson and re-runs the shared enrollment-completion math (which issues
// the training record + certificate when the course is done).

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import { attachments, trainingLessonProgress, trainingLessons } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAuditInTransaction } from '@/lib/audit'
import { withStoredSignatureAttachment } from '@/lib/signature-storage'
import {
  optionalTrainingText,
  parsePracticalCriteria,
  parsePracticalEvaluationResults,
  requireTrainingUuid,
} from '@/lib/training-mutation-validation'
import { enrollInCourse } from '../../../learn/_actions'
import { recomputeEnrollmentCompletion } from '../../../learn/_lib/completion'
import { requireOpenTrainingEnrollment } from '../../../learn/_lib/enrollment'

// Staff enrollment for assigned delivery types (classroom, on-the-job): puts a
// learner into the evaluations grid. Permission enforcement (training-write)
// lives in enrollInCourse — enrolling someone else is the privileged path.
export async function enrollLearner(courseId: string, formData: FormData) {
  courseId = requireTrainingUuid(courseId, 'Course')
  const personId = requireTrainingUuid(formData.get('personId'), 'Person')
  await enrollInCourse(courseId, personId)
  revalidatePath(`/training/courses/${courseId}/evaluations`)
}

export async function evaluatePractical(args: {
  courseId: string
  enrollmentId: string
  lessonId: string
  pass: boolean
  criteriaResults: Record<string, boolean>
  notes: string | null
  signatureDataUrl: string | null
}): Promise<{ ok: true; courseCompleted: boolean } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) return { ok: false, error: 'No active tenant' }
  const tenantId = ctx.tenantId

  try {
    const courseId = requireTrainingUuid(args.courseId, 'Course')
    const enrollmentId = requireTrainingUuid(args.enrollmentId, 'Enrollment')
    const lessonId = requireTrainingUuid(args.lessonId, 'Lesson')
    if (typeof args.pass !== 'boolean') throw new Error('Evaluation result is invalid.')
    const notes = optionalTrainingText(args.notes, 'Evaluation notes', 20_000)
    if (
      args.signatureDataUrl !== null &&
      args.signatureDataUrl !== undefined &&
      typeof args.signatureDataUrl !== 'string'
    ) {
      throw new Error('Signature payload is invalid.')
    }
    const signatureDataUrl = args.signatureDataUrl?.trim() || null
    if (args.pass && !signatureDataUrl) {
      throw new Error('A signature is required to sign a learner off as competent.')
    }
    if ((signatureDataUrl?.length ?? 0) > 1_500_000) {
      throw new Error('Signature payload too large')
    }

    const result = await withStoredSignatureAttachment(
      ctx,
      signatureDataUrl,
      async (tx, signatureAttachmentId) => {
        if (args.pass && !signatureAttachmentId) {
          throw new Error('A signature is required to sign a learner off as competent.')
        }
        const enrollment = await requireOpenTrainingEnrollment(tx, {
          enrollmentId,
          expectedCourseId: courseId,
        })
        const [lesson] = await tx
          .select()
          .from(trainingLessons)
          .where(
            and(
              eq(trainingLessons.id, lessonId),
              eq(trainingLessons.courseId, courseId),
              isNull(trainingLessons.deletedAt),
            ),
          )
          .limit(1)
        if (!lesson) throw new Error('Lesson not found')
        if (lesson.kind !== 'practical') throw new Error('Not a practical lesson')
        const criteria =
          parsePracticalCriteria(JSON.stringify(lesson.practicalCriteria ?? [])) ?? []
        const criteriaResults = parsePracticalEvaluationResults(
          args.criteriaResults,
          criteria,
          args.pass,
        )

        const now = new Date()
        const evaluatorFields = {
          evaluatedByTenantUserId: ctx.membership?.id ?? null,
          evaluationNotes: notes,
          evaluationSignatureAttachmentId: signatureAttachmentId,
          criteriaResults,
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
        if (existing && existing.personId !== enrollment.personId) {
          throw new Error('Lesson progress does not belong to this learner.')
        }
        let progressId: string
        if (existing) {
          const [updated] = await tx
            .update(trainingLessonProgress)
            .set({
              status: args.pass ? 'completed' : 'in_progress',
              completedAt: args.pass ? now : null,
              ...evaluatorFields,
            })
            .where(eq(trainingLessonProgress.id, existing.id))
            .returning({ id: trainingLessonProgress.id })
          if (!updated) throw new Error('Could not save the evaluation.')
          progressId = updated.id
        } else {
          const [created] = await tx
            .insert(trainingLessonProgress)
            .values({
              tenantId,
              enrollmentId,
              lessonId,
              personId: enrollment.personId,
              status: args.pass ? 'completed' : 'in_progress',
              startedAt: now,
              completedAt: args.pass ? now : null,
              ...evaluatorFields,
            })
            .returning({ id: trainingLessonProgress.id })
          if (!created) throw new Error('Could not save the evaluation.')
          progressId = created.id
        }

        if (
          existing?.evaluationSignatureAttachmentId &&
          existing.evaluationSignatureAttachmentId !== signatureAttachmentId
        ) {
          // The attachment-delete trigger enqueues durable object cleanup in
          // this transaction, so replacement cannot silently strand storage.
          const [removedSignature] = await tx
            .delete(attachments)
            .where(
              and(
                eq(attachments.id, existing.evaluationSignatureAttachmentId),
                eq(attachments.kind, 'signature'),
              ),
            )
            .returning({ id: attachments.id })
          if (!removedSignature) throw new Error('Previous evaluation signature is missing.')
        }

        const summary = await recomputeEnrollmentCompletion(tx, {
          tenantId,
          enrollmentId,
          courseId,
          personId: enrollment.personId,
        })
        await recordAuditInTransaction(tx, ctx, {
          entityType: 'training_lesson_progress',
          entityId: progressId,
          action: 'sign',
          summary: `Practical ${args.pass ? 'signed off' : 'marked not-yet-competent'} (enrollment ${enrollmentId})`,
          after: {
            enrollmentId,
            lessonId,
            pass: args.pass,
            criteriaResults,
            courseCompleted: summary.newlyCompleted,
            recordId: summary.recordId,
          },
        })
        return {
          progressId,
          criteriaResults,
          courseCompleted: summary.newlyCompleted,
          recordId: summary.recordId,
        }
      },
    )

    revalidatePath(`/training/courses/${courseId}/evaluations`)
    revalidatePath(`/training/learn/${courseId}`)
    return { ok: true, courseCompleted: result.courseCompleted }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Evaluation failed' }
  }
}
