'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, asc, eq, ilike, isNull, ne, or, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { documentCategories } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { assertValidCategoryParent } from './_category-parent-policy'
import {
  CATEGORY_DELETE_CONFLICT_MESSAGE,
  CategoryNameConflictError,
  categoryErrorHref,
  categoryMutationErrorMessage,
  isUniqueViolation,
  safeCategoryReturnTo,
} from './_category-mutation-policy'

export type CategoryParentOption = { id: string; name: string }

function requiredText(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? '').trim()
  if (!value) throw new Error(`${key} is required.`)
  return value
}

function optionalParentId(formData: FormData): string | null {
  const value = String(formData.get('parentId') ?? '').trim()
  if (!value) return null
  if (!isUuid(value)) throw new Error('The selected parent category is invalid.')
  return value
}

function normalizedNameMatch(name: string) {
  return sql`lower(btrim(${documentCategories.name})) = lower(btrim(${name}))`
}

function parentMatch(parentId: string | null) {
  return parentId ? eq(documentCategories.parentId, parentId) : isNull(documentCategories.parentId)
}

function categoryReturnTo(formData: FormData): string {
  return safeCategoryReturnTo(formData.get('returnTo'))
}

async function lockCategoryHierarchy(tx: Database, tenantId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`document-categories:${tenantId}`}, 0))`,
  )
}

export async function searchCategoryParents(
  query: string,
  excludeId?: string,
): Promise<CategoryParentOption[]> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'documents')
  const q = query.trim().slice(0, 100)
  const safeExcludeId = excludeId && isUuid(excludeId) ? excludeId : undefined

  return ctx.db((tx) =>
    tx
      .select({ id: documentCategories.id, name: documentCategories.name })
      .from(documentCategories)
      .where(
        and(
          isNull(documentCategories.deletedAt),
          safeExcludeId ? ne(documentCategories.id, safeExcludeId) : undefined,
          q
            ? or(
                ilike(documentCategories.name, `%${q}%`),
                ilike(documentCategories.description, `%${q}%`),
              )
            : undefined,
        ),
      )
      .orderBy(asc(documentCategories.name), asc(documentCategories.id))
      .limit(25),
  )
}

export async function createCategory(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'documents')
  const name = requiredText(formData, 'name')
  const parentId = optionalParentId(formData)
  const description = String(formData.get('description') ?? '').trim() || null
  const returnTo = categoryReturnTo(formData)

  let row: typeof documentCategories.$inferSelect | undefined
  try {
    const rows = await ctx.db(async (tx) => {
      // withTenant() already owns the transaction, so serialize hierarchy
      // mutations with a tenant-keyed transaction lock. This closes the race
      // where A→B and B→A could both validate before either write committed.
      await lockCategoryHierarchy(tx, ctx.tenantId)
      await assertValidCategoryParent({
        categoryId: null,
        parentId,
        loadParent: async (id) => {
          const [parent] = await tx
            .select({ id: documentCategories.id, parentId: documentCategories.parentId })
            .from(documentCategories)
            .where(and(eq(documentCategories.id, id), isNull(documentCategories.deletedAt)))
            .limit(1)
          return parent ?? null
        },
      })
      const [conflict] = await tx
        .select({ id: documentCategories.id })
        .from(documentCategories)
        .where(
          and(
            isNull(documentCategories.deletedAt),
            parentMatch(parentId),
            normalizedNameMatch(name),
          ),
        )
        .limit(1)
      if (conflict) throw new CategoryNameConflictError()
      return tx
        .insert(documentCategories)
        .values({ tenantId: ctx.tenantId, name, parentId, description })
        .returning()
    })
    row = rows[0]
  } catch (error) {
    const message = categoryMutationErrorMessage(error)
    if (message) redirect(categoryErrorHref(returnTo, message))
    throw error
  }

  if (row) {
    await recordAudit(ctx, {
      entityType: 'document_category',
      entityId: row.id,
      action: 'create',
      summary: `Created document category "${name}"`,
      after: { name, parentId, description },
    })
  }
  revalidatePath('/documents/categories')
  redirect(returnTo)
}

export async function updateCategory(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'documents')
  const id = requiredText(formData, 'id')
  if (!isUuid(id)) throw new Error('The category is invalid.')
  const name = requiredText(formData, 'name')
  const parentId = optionalParentId(formData)
  const description = String(formData.get('description') ?? '').trim() || null
  const returnTo = categoryReturnTo(formData)

  let row: { id: string } | undefined
  try {
    const rows = await ctx.db(async (tx) => {
      await lockCategoryHierarchy(tx, ctx.tenantId)
      await assertValidCategoryParent({
        categoryId: id,
        parentId,
        loadParent: async (candidateId) => {
          const [parent] = await tx
            .select({ id: documentCategories.id, parentId: documentCategories.parentId })
            .from(documentCategories)
            .where(
              and(eq(documentCategories.id, candidateId), isNull(documentCategories.deletedAt)),
            )
            .limit(1)
          return parent ?? null
        },
      })
      const [conflict] = await tx
        .select({ id: documentCategories.id })
        .from(documentCategories)
        .where(
          and(
            isNull(documentCategories.deletedAt),
            parentMatch(parentId),
            normalizedNameMatch(name),
            ne(documentCategories.id, id),
          ),
        )
        .limit(1)
      if (conflict) throw new CategoryNameConflictError()
      return tx
        .update(documentCategories)
        .set({ name, parentId, description })
        .where(and(eq(documentCategories.id, id), isNull(documentCategories.deletedAt)))
        .returning({ id: documentCategories.id })
    })
    row = rows[0]
  } catch (error) {
    const message = categoryMutationErrorMessage(error)
    if (message) redirect(categoryErrorHref(returnTo, message))
    throw error
  }

  if (row) {
    await recordAudit(ctx, {
      entityType: 'document_category',
      entityId: id,
      action: 'update',
      summary: 'Updated document category',
      after: { name, parentId, description },
    })
  }
  revalidatePath('/documents/categories')
  redirect(returnTo)
}

export async function deleteCategory(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'documents')
  const id = requiredText(formData, 'id')
  if (!isUuid(id)) throw new Error('The category is invalid.')
  const returnTo = categoryReturnTo(formData)

  let deleted = false
  try {
    deleted = await ctx.db(async (tx) => {
      await lockCategoryHierarchy(tx, ctx.tenantId)
      const [row] = await tx
        .select({ parentId: documentCategories.parentId })
        .from(documentCategories)
        .where(and(eq(documentCategories.id, id), isNull(documentCategories.deletedAt)))
        .limit(1)
      if (!row) return false

      // Keep every child reachable by moving it to the deleted node's parent.
      // The active sibling-name index rejects a move that would collide.
      await tx
        .update(documentCategories)
        .set({ parentId: row.parentId })
        .where(eq(documentCategories.parentId, id))
      await tx
        .update(documentCategories)
        .set({ deletedAt: new Date() })
        .where(and(eq(documentCategories.id, id), isNull(documentCategories.deletedAt)))
      return true
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      redirect(categoryErrorHref(returnTo, CATEGORY_DELETE_CONFLICT_MESSAGE))
    }
    throw error
  }

  if (deleted) {
    await recordAudit(ctx, {
      entityType: 'document_category',
      entityId: id,
      action: 'delete',
      summary: 'Soft-deleted document category',
    })
  }
  revalidatePath('/documents/categories')
  redirect(returnTo)
}
