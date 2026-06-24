import 'server-only'

// Documents FlowSubjectAdapter — subject = a document MANAGEMENT REVIEW.
// Field-map keys mirror MODULE_FLOW_PROFILES.documents.

import { eq, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  correctiveActions,
  documentManagementReviews,
  documents,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { buildRecordSummaryPdfJob } from '../pdf-summary'
import { fmtDate, titleize } from '../format'
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
      const chairTU = alias(tenantUsers, 'dmr_chair_tu')
      const chairU = alias(users, 'dmr_chair_u')
      const ownTU = alias(tenantUsers, 'dmr_own_tu')
      const ownU = alias(users, 'dmr_own_u')
      const [head] = await ctx.db((tx) =>
        tx
          .select({
            r: documentManagementReviews,
            chairName: chairU.name,
            ownerName: ownU.name,
          })
          .from(documentManagementReviews)
          .leftJoin(chairTU, eq(chairTU.id, documentManagementReviews.chairedByTenantUserId))
          .leftJoin(chairU, eq(chairU.id, chairTU.userId))
          .leftJoin(ownTU, eq(ownTU.id, documentManagementReviews.createdByTenantUserId))
          .leftJoin(ownU, eq(ownU.id, ownTU.userId))
          .where(eq(documentManagementReviews.id, reviewId))
          .limit(1),
      )
      if (!head) return {}
      const r = head.r
      const participantIds = r.participants ?? []
      const docIds = r.documentsReviewed ?? []
      const caIds = r.actionItemsCreated ?? []

      const [attendees, docsReviewed, actionItems] = await Promise.all([
        participantIds.length
          ? ctx.db((tx) =>
              tx
                .select({ name: users.name, email: users.email })
                .from(tenantUsers)
                .innerJoin(users, eq(users.id, tenantUsers.userId))
                .where(inArray(tenantUsers.id, participantIds)),
            )
          : Promise.resolve([] as { name: string | null; email: string | null }[]),
        docIds.length
          ? ctx.db((tx) =>
              tx
                .select({ title: documents.title, status: documents.status })
                .from(documents)
                .where(inArray(documents.id, docIds)),
            )
          : Promise.resolve([] as { title: string; status: string }[]),
        caIds.length
          ? ctx.db((tx) =>
              tx
                .select({
                  reference: correctiveActions.reference,
                  title: correctiveActions.title,
                  status: correctiveActions.status,
                  dueOn: correctiveActions.dueOn,
                })
                .from(correctiveActions)
                .where(inArray(correctiveActions.id, caIds)),
            )
          : Promise.resolve(
              [] as { reference: string; title: string; status: string; dueOn: string | null }[],
            ),
      ])

      return {
        title: r.title ?? null,
        period_start: fmtDate(r.periodStart),
        period_end: fmtDate(r.periodEnd),
        next_review_on: fmtDate(r.nextReviewOn),
        discussion_notes: r.discussionNotes ?? '',
        decisions: r.decisions ?? '',
        chair_name: head.chairName ?? '',
        owner_name: head.ownerName ?? '',
        attendees: attendees.map((a) => ({ name: a.name ?? '', email: a.email ?? '' })),
        documents_reviewed: docsReviewed.map((d) => ({
          title: d.title ?? '',
          status: titleize(d.status),
        })),
        action_items: actionItems.map((c) => ({
          reference: c.reference ?? '',
          title: c.title ?? '',
          status: titleize(c.status),
          due_on: fmtDate(c.dueOn),
        })),
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
