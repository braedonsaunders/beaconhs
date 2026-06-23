'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { documentManagementReviews } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { runModuleFlows } from '@/lib/flows/run-module-flows'

/**
 * Instant-create a management review and land in its detail editor (the single
 * view+edit surface) — no separate create form, no create drawer. Title and
 * period end default to placeholders the user adjusts on the detail page;
 * reviewed documents, participants and follow-up actions are attached there too.
 */
export async function createManagementReview(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const title = String(formData.get('title') ?? '').trim() || 'Untitled review'
  const periodEnd =
    String(formData.get('periodEnd') ?? '').trim() || new Date().toISOString().slice(0, 10)
  const id = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(documentManagementReviews)
      .values({
        tenantId: ctx.tenantId,
        title,
        periodEnd,
        chairedByTenantUserId: ctx.membership?.id ?? null,
        createdByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning({ id: documentManagementReviews.id })
    if (!row) throw new Error('Failed to create management review')
    return row.id
  })
  await recordAudit(ctx, {
    entityType: 'document_management_review',
    entityId: id,
    action: 'create',
    summary: `Recorded management review "${title}"`,
    after: { title, periodEnd },
  })
  await runModuleFlows(ctx, { moduleKey: 'documents', event: 'on_create', subjectId: id })
  revalidatePath('/documents/management-reviews')
  redirect(`/documents/management-reviews/${id}`)
}

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
