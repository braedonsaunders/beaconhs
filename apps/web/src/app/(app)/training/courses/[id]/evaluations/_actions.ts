'use server'

// Practical-test sign-off. Training managers evaluate a learner against the
// lesson's criteria, capture a signature, and pass/fail them. A pass completes
// the lesson and re-runs the shared enrollment-completion math (which issues
// the training record + certificate when the course is done).

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import {
  trainingEnrollments,
  trainingLessonProgress,
  trainingLessons,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { recomputeEnrollmentCompletion } from '../../../learn/_lib/completion'

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
  if (args.pass && !args.signatureDataUrl) {
    return { ok: false, error: 'A signature is required to sign a learner off as competent.' }
  }
  if ((args.signatureDataUrl?.length ?? 0) > 1_500_000) {
    return { ok: false, error: 'Signature payload too large' }
  }

  try {
    const result = await ctx.db(async (tx) => {
      const [enr] = await tx
        .select()
        .from(trainingEnrollments)
        .where(eq(trainingEnrollments.id, args.enrollmentId))
        .limit(1)
      if (!enr || enr.courseId !== args.courseId) throw new Error('Enrollment not found')
      const [lesson] = await tx
        .select()
        .from(trainingLessons)
        .where(eq(trainingLessons.id, args.lessonId))
        .limit(1)
      if (!lesson || lesson.courseId !== args.courseId) throw new Error('Lesson not found')
      if (lesson.kind !== 'practical') throw new Error('Not a practical lesson')

      const now = new Date()
      const evaluatorFields = {
        evaluatedByTenantUserId: ctx.membership?.id ?? null,
        evaluationNotes: args.notes,
        evaluationSignatureDataUrl: args.signatureDataUrl,
        criteriaResults: args.criteriaResults,
      }
      const [existing] = await tx
        .select()
        .from(trainingLessonProgress)
        .where(
          and(
            eq(trainingLessonProgress.enrollmentId, args.enrollmentId),
            eq(trainingLessonProgress.lessonId, args.lessonId),
          ),
        )
        .limit(1)
      if (existing) {
        await tx
          .update(trainingLessonProgress)
          .set({
            status: args.pass ? 'completed' : 'in_progress',
            completedAt: args.pass ? now : null,
            ...evaluatorFields,
          })
          .where(eq(trainingLessonProgress.id, existing.id))
      } else {
        await tx.insert(trainingLessonProgress).values({
          tenantId,
          enrollmentId: args.enrollmentId,
          lessonId: args.lessonId,
          personId: enr.personId,
          status: args.pass ? 'completed' : 'in_progress',
          startedAt: now,
          completedAt: args.pass ? now : null,
          ...evaluatorFields,
        })
      }

      if (args.pass) {
        const summary = await recomputeEnrollmentCompletion(tx, {
          tenantId,
          enrollmentId: args.enrollmentId,
          courseId: args.courseId,
          personId: enr.personId,
        })
        return { courseCompleted: summary.completed, recordId: summary.recordId }
      }
      return { courseCompleted: false, recordId: null }
    })

    await recordAudit(ctx, {
      entityType: 'training_lesson_progress',
      entityId: args.lessonId,
      action: 'sign',
      summary: `Practical ${args.pass ? 'signed off' : 'marked not-yet-competent'} (enrollment ${args.enrollmentId})`,
      after: {
        enrollmentId: args.enrollmentId,
        pass: args.pass,
        criteriaResults: args.criteriaResults,
        courseCompleted: result.courseCompleted,
        recordId: result.recordId,
      },
    })
    revalidatePath(`/training/courses/${args.courseId}/evaluations`)
    revalidatePath(`/training/learn/${args.courseId}`)
    return { ok: true, courseCompleted: result.courseCompleted }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Evaluation failed' }
  }
}
