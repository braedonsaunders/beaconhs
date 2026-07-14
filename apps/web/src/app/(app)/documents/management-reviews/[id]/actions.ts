'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import {
  documentManagementReviewDocuments,
  documentManagementReviews,
  documents,
  documentVersions,
} from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { recordModuleFlowEvent } from '@beaconhs/events'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit, recordAuditInTransaction } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'

/**
 * Instant-create a management review and land in its detail editor (the single
 * view+edit surface) — no separate create form, no create drawer. Title and
 * period end default to placeholders the user adjusts on the detail page;
 * reviewed documents, participants and follow-up actions are attached there too.
 */
export async function createManagementReview(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
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
    await recordModuleFlowEvent(tx, ctx, {
      subjectId: row.id,
      moduleKey: 'documents',
      event: 'on_create',
      occurrenceKey: row.id,
    })
    return row.id
  })
  await recordAudit(ctx, {
    entityType: 'document_management_review',
    entityId: id,
    action: 'create',
    summary: `Recorded management review "${title}"`,
    after: { title, periodEnd },
  })
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
  assertCan(ctx, 'documents.manage')
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
  assertCan(ctx, 'documents.manage')
  if (!isUuid(id)) throw new Error('Management review not found')
  if (docIds.some((documentId) => !isUuid(documentId))) {
    throw new Error('A selected document is invalid')
  }
  const uniqueDocumentIds = [...new Set(docIds)]
  if (uniqueDocumentIds.length !== docIds.length) {
    throw new Error('The same document cannot be reviewed twice')
  }

  await ctx.db(async (tx) => {
    const [review] = await tx
      .select({ id: documentManagementReviews.id })
      .from(documentManagementReviews)
      .where(
        and(
          eq(documentManagementReviews.tenantId, ctx.tenantId),
          eq(documentManagementReviews.id, id),
          isNull(documentManagementReviews.deletedAt),
        ),
      )
      .limit(1)
      .for('update')
    if (!review) throw new Error('Management review not found')

    const sortedDocumentIds = [...uniqueDocumentIds].sort()
    const lockedDocuments =
      sortedDocumentIds.length > 0
        ? await tx
            .select({ id: documents.id })
            .from(documents)
            .where(
              and(
                eq(documents.tenantId, ctx.tenantId),
                inArray(documents.id, sortedDocumentIds),
                eq(documents.status, 'published'),
                isNull(documents.deletedAt),
              ),
            )
            .orderBy(asc(documents.id))
            .for('update')
        : []
    if (lockedDocuments.length !== sortedDocumentIds.length) {
      throw new Error('Every reviewed document must be active and published')
    }

    const versions =
      sortedDocumentIds.length > 0
        ? await tx
            .select({
              id: documentVersions.id,
              documentId: documentVersions.documentId,
              version: documentVersions.version,
            })
            .from(documentVersions)
            .where(
              and(
                eq(documentVersions.tenantId, ctx.tenantId),
                inArray(documentVersions.documentId, sortedDocumentIds),
                isNotNull(documentVersions.publishedAt),
              ),
            )
            .orderBy(asc(documentVersions.documentId), desc(documentVersions.version))
        : []
    const latestByDocument = new Map<string, { id: string; documentId: string; version: number }>()
    for (const version of versions) {
      if (!latestByDocument.has(version.documentId)) {
        latestByDocument.set(version.documentId, version)
      }
    }
    const pins = sortedDocumentIds.map((documentId) => {
      const version = latestByDocument.get(documentId)
      if (!version) throw new Error('A reviewed document has no published version')
      return version
    })

    await tx
      .delete(documentManagementReviewDocuments)
      .where(
        and(
          eq(documentManagementReviewDocuments.tenantId, ctx.tenantId),
          eq(documentManagementReviewDocuments.managementReviewId, id),
        ),
      )
    if (pins.length > 0) {
      await tx.insert(documentManagementReviewDocuments).values(
        pins.map((pin) => ({
          tenantId: ctx.tenantId,
          managementReviewId: id,
          documentId: pin.documentId,
          documentVersionId: pin.id,
        })),
      )
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'document_management_review',
      entityId: id,
      action: 'update',
      summary: `Updated documents reviewed (${pins.length})`,
      after: {
        reviewedDocuments: pins.map((pin) => ({
          documentId: pin.documentId,
          documentVersionId: pin.id,
          version: pin.version,
        })),
      },
    })
  })
  revalidatePath(`/documents/management-reviews/${id}`)
}

export async function updateActionItems(id: string, caIds: string[]): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
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

async function deleteManagementReview(id: string): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const deletedAt = new Date()
  const [row] = await ctx.db((tx) =>
    tx
      .update(documentManagementReviews)
      .set({ deletedAt })
      .where(and(eq(documentManagementReviews.id, id), isNull(documentManagementReviews.deletedAt)))
      .returning({ title: documentManagementReviews.title }),
  )
  if (!row) throw new Error('Management review not found')
  await recordAudit(ctx, {
    entityType: 'document_management_review',
    entityId: id,
    action: 'delete',
    summary: `Soft-deleted management review "${row.title}"`,
    after: { deletedAt: deletedAt.toISOString() },
  })
  revalidatePath('/documents/management-reviews')
  revalidatePath(`/documents/management-reviews/${id}`)
}

export async function deleteManagementReviewAndRedirect(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await deleteManagementReview(id)
  redirect('/documents/management-reviews')
}
