import 'server-only'

// Documents FlowSubjectAdapter — subject = a document MANAGEMENT REVIEW.
// Field-map keys mirror MODULE_FLOW_PROFILES.documents.

import { eq } from 'drizzle-orm'
import { documentManagementReviews, tenantUsers, users } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { buildRecordSummaryPdfJob } from '../pdf-summary'
import type { FlowSubjectAdapter } from '../types'

export function createDocumentFlowAdapter(
  ctx: RequestContext,
  reviewId: string,
): FlowSubjectAdapter {
  return {
    subjectType: 'module',
    subjectKey: 'documents',
    subjectId: reviewId,
    notifyCategory: 'document',
    auditEntityType: 'document_management_review',
    deepLink: () => `/documents/management-reviews/${reviewId}`,
    pdfJob: (values) =>
      buildRecordSummaryPdfJob({
        tenantId: ctx.tenantId,
        subjectId: reviewId,
        entityType: 'document_management_review',
        heading: 'Management review',
        reference: reviewId.slice(0, 8),
        subtitle: values.title,
        values,
      }),

    async loadValues() {
      const [r] = await ctx.db((tx) =>
        tx
          .select({
            title: documentManagementReviews.title,
            periodStart: documentManagementReviews.periodStart,
            periodEnd: documentManagementReviews.periodEnd,
            nextReviewOn: documentManagementReviews.nextReviewOn,
          })
          .from(documentManagementReviews)
          .where(eq(documentManagementReviews.id, reviewId))
          .limit(1),
      )
      return {
        title: r?.title ?? null,
        period_start: r?.periodStart ?? null,
        period_end: r?.periodEnd ?? null,
        next_review_on: r?.nextReviewOn ?? null,
      }
    },

    async resolveSubmitter() {
      const [r] = await ctx.db((tx) =>
        tx
          .select({
            chaired: documentManagementReviews.chairedByTenantUserId,
            createdBy: documentManagementReviews.createdByTenantUserId,
          })
          .from(documentManagementReviews)
          .where(eq(documentManagementReviews.id, reviewId))
          .limit(1),
      )
      const tuid = r?.chaired ?? r?.createdBy ?? null
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
