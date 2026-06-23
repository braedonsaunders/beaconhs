import 'server-only'

// Training FlowSubjectAdapter — subject = a training ASSESSMENT (attempt).
// Field-map keys mirror MODULE_FLOW_PROFILES.training.

import { eq } from 'drizzle-orm'
import { trainingAssessments, tenantUsers, users } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { buildRecordSummaryPdfJob } from '../pdf-summary'
import type { FlowSubjectAdapter } from '../types'

export function createTrainingFlowAdapter(
  ctx: RequestContext,
  assessmentId: string,
): FlowSubjectAdapter {
  return {
    subjectType: 'module',
    subjectKey: 'training',
    subjectId: assessmentId,
    notifyCategory: 'training',
    auditEntityType: 'training_assessment',
    deepLink: () => `/training/assessments/${assessmentId}`,
    pdfJob: (values) =>
      buildRecordSummaryPdfJob({
        tenantId: ctx.tenantId,
        subjectId: assessmentId,
        entityType: 'training_assessment',
        heading: 'Training assessment',
        reference: assessmentId.slice(0, 8),
        subtitle: 'Assessment result',
        values,
      }),

    async loadValues() {
      const [a] = await ctx.db((tx) =>
        tx
          .select({
            status: trainingAssessments.status,
            score: trainingAssessments.score,
            passed: trainingAssessments.passed,
            typeId: trainingAssessments.typeId,
            personId: trainingAssessments.personId,
            completedAt: trainingAssessments.completedAt,
          })
          .from(trainingAssessments)
          .where(eq(trainingAssessments.id, assessmentId))
          .limit(1),
      )
      return {
        status: a?.status ?? null,
        score: a?.score ?? null,
        passed: a?.passed ?? null,
        type_id: a?.typeId ?? null,
        person_id: a?.personId ?? null,
        completed_at: a?.completedAt ? a.completedAt.toISOString() : null,
      }
    },

    async resolveSubmitter() {
      const [a] = await ctx.db((tx) =>
        tx
          .select({ tuid: trainingAssessments.submittedByTenantUserId })
          .from(trainingAssessments)
          .where(eq(trainingAssessments.id, assessmentId))
          .limit(1),
      )
      const tuid = a?.tuid ?? null
      let email: string | null = null
      let userId: string | null = null
      if (tuid) {
        const [u] = await ctx.db((tx) =>
          tx
            .select({ email: users.email, userId: users.id })
            .from(tenantUsers)
            .innerJoin(users, eq(users.id, tenantUsers.userId))
            .where(eq(tenantUsers.id, tuid))
            .limit(1),
        )
        email = u?.email ?? null
        userId = u?.userId ?? null
      }
      return { tenantUserId: tuid, email, userId }
    },
  }
}
