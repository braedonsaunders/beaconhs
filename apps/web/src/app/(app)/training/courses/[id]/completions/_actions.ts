'use server'

import { revalidatePath } from 'next/cache'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAuditInTransaction } from '@/lib/audit'
import { optionalTextInput } from '@/lib/mutation-input'
import { requireTrainingUuid } from '@/lib/training-mutation-validation'
import { completeVerifiedOnlineEnrollment } from '../../../learn/_lib/completion'
import { requireOpenTrainingEnrollment } from '../../../learn/_lib/enrollment'

export async function completeOnlineCourseEnrollment(
  courseId: string,
  enrollmentId: string,
  formData: FormData,
): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  courseId = requireTrainingUuid(courseId, 'Course')
  enrollmentId = requireTrainingUuid(enrollmentId, 'Enrollment')
  const note = optionalTextInput(formData.get('note'), 'Verification note', 2_000)
  const reviewerTenantUserId = ctx.membership?.id
  if (!reviewerTenantUserId) throw new Error('An active tenant membership is required.')

  await ctx.db(async (tx) => {
    const enrollment = await requireOpenTrainingEnrollment(tx, {
      enrollmentId,
      expectedCourseId: courseId,
    })
    if (enrollment.deliveryType !== 'online') throw new Error('This is not an online course.')
    if (!enrollment.completionRequestedAt) {
      throw new Error('The learner has not submitted this course for verification.')
    }
    const completion = await completeVerifiedOnlineEnrollment(tx, {
      tenantId: ctx.tenantId,
      enrollmentId,
      courseId,
      personId: enrollment.personId,
      reviewerTenantUserId,
      reviewNote: note,
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_enrollment',
      entityId: enrollmentId,
      action: 'update',
      summary: `Verified online course completion — issued record ${completion.recordId}`,
      after: {
        recordId: completion.recordId,
        certificateId: completion.certificateId,
        completionReviewedByTenantUserId: reviewerTenantUserId,
      },
      metadata: { courseId, note },
      dedupKey: `training.online-completion-verified:${enrollmentId}`,
    })
  })

  revalidatePath(`/training/courses/${courseId}/completions`)
  revalidatePath(`/training/courses/${courseId}`)
  revalidatePath('/training/records')
  revalidatePath('/my/training')
  revalidatePath('/compliance/mine')
}
