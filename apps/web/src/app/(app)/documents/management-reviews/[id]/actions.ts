'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { documentManagementReviews } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

export async function updateReviewMeta(
  id: string,
  patch: {
    title: string
    periodStart: string | null
    periodEnd: string
    nextReviewOn: string | null
    discussionNotes: string | null
    decisions: string | null
    participants: string[]
  },
): Promise<void> {
  const ctx = await requireRequestContext()
  await ctx.db((tx) =>
    tx
      .update(documentManagementReviews)
      .set({
        title: patch.title,
        periodStart: patch.periodStart,
        periodEnd: patch.periodEnd,
        nextReviewOn: patch.nextReviewOn,
        discussionNotes: patch.discussionNotes,
        decisions: patch.decisions,
        participants: patch.participants,
      })
      .where(eq(documentManagementReviews.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'document_management_review',
    entityId: id,
    action: 'update',
    summary: 'Updated management review',
    after: patch,
  })
  revalidatePath(`/documents/management-reviews/${id}`)
}

export async function updateDocumentsReviewed(id: string, docIds: string[]): Promise<void> {
  const ctx = await requireRequestContext()
  await ctx.db((tx) =>
    tx
      .update(documentManagementReviews)
      .set({ documentsReviewed: docIds })
      .where(eq(documentManagementReviews.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'document_management_review',
    entityId: id,
    action: 'update',
    summary: `Updated documents reviewed (${docIds.length})`,
    after: { documentsReviewed: docIds },
  })
  revalidatePath(`/documents/management-reviews/${id}`)
}

export async function updateActionItems(id: string, caIds: string[]): Promise<void> {
  const ctx = await requireRequestContext()
  await ctx.db((tx) =>
    tx
      .update(documentManagementReviews)
      .set({ actionItemsCreated: caIds })
      .where(eq(documentManagementReviews.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'document_management_review',
    entityId: id,
    action: 'update',
    summary: `Updated linked action items (${caIds.length})`,
    after: { actionItemsCreated: caIds },
  })
  revalidatePath(`/documents/management-reviews/${id}`)
}

export async function deleteManagementReview(id: string): Promise<void> {
  const ctx = await requireRequestContext()
  await ctx.db((tx) =>
    tx
      .update(documentManagementReviews)
      .set({ deletedAt: new Date() })
      .where(eq(documentManagementReviews.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'document_management_review',
    entityId: id,
    action: 'delete',
    summary: 'Soft-deleted management review',
  })
  revalidatePath('/documents/management-reviews')
}
