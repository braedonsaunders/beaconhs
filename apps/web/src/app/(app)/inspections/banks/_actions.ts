'use server'

// Server actions for the inspection BANK builder. A bank is a flat, reusable
// pool of criteria that types import from. Typed object args — called from the
// client builder inside a transition.

import { revalidatePath } from 'next/cache'
import { eq, sql } from 'drizzle-orm'
import { inspectionBankCriteria, inspectionBanks } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { parseInspectionResponseConfig } from '@/lib/inspection-response-config'

async function manageCtx() {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'inspections')
  return ctx
}

function revalidateBank(id: string) {
  revalidatePath(`/inspections/banks/${id}`)
  revalidatePath('/inspections/banks')
}

export async function updateBank(input: {
  id: string
  name: string
  description: string | null
  category: string | null
}) {
  const ctx = await manageCtx()
  const name = input.name.trim()
  if (!name) throw new Error('Name is required')
  await ctx.db((tx) =>
    tx
      .update(inspectionBanks)
      .set({
        name,
        description: input.description?.trim() || null,
        category: input.category?.trim() || null,
      })
      .where(eq(inspectionBanks.id, input.id)),
  )
  await recordAudit(ctx, {
    entityType: 'inspection_bank',
    entityId: input.id,
    action: 'update',
    summary: 'Bank details updated',
  })
  revalidateBank(input.id)
}

export async function toggleBankPublished(input: { id: string; next: boolean }) {
  const ctx = await manageCtx()
  await ctx.db((tx) =>
    tx
      .update(inspectionBanks)
      .set({ isPublished: input.next })
      .where(eq(inspectionBanks.id, input.id)),
  )
  await recordAudit(ctx, {
    entityType: 'inspection_bank',
    entityId: input.id,
    action: input.next ? 'publish' : 'update',
    summary: input.next ? 'Published' : 'Moved back to draft',
  })
  revalidateBank(input.id)
}

export async function addBankCriterion(input: {
  bankId: string
  text: string
  responseType?: string
  choiceOptions?: string[]
  requiresPhoto?: boolean
  requiresComment?: boolean
}) {
  const ctx = await manageCtx()
  const text = input.text.trim()
  if (!text) throw new Error('Question is required')
  const response = parseInspectionResponseConfig(input.responseType, input.choiceOptions ?? [])
  const id = await ctx.db(async (tx) => {
    const [maxRow] = await tx
      .select({
        m: sql<number>`coalesce(max(${inspectionBankCriteria.sequence}), -1)`.mapWith(Number),
      })
      .from(inspectionBankCriteria)
      .where(eq(inspectionBankCriteria.bankId, input.bankId))
    const [row] = await tx
      .insert(inspectionBankCriteria)
      .values({
        tenantId: ctx.tenantId,
        bankId: input.bankId,
        sequence: Number(maxRow?.m ?? -1) + 1,
        text,
        responseType: response.responseType,
        choiceOptions: response.choiceOptions,
        requiresPhoto: Boolean(input.requiresPhoto),
        requiresComment: Boolean(input.requiresComment),
      })
      .returning({ id: inspectionBankCriteria.id })
    return row?.id
  })
  await recordAudit(ctx, {
    entityType: 'inspection_bank',
    entityId: input.bankId,
    action: 'update',
    summary: `Added criterion: "${text.slice(0, 60)}"`,
  })
  revalidateBank(input.bankId)
  return { id }
}

export async function updateBankCriterion(input: {
  bankId: string
  id: string
  text?: string
  responseType?: string
  choiceOptions?: string[]
  requiresPhoto?: boolean
  requiresComment?: boolean
}) {
  const ctx = await manageCtx()
  await ctx.db(async (tx) => {
    const patch: Record<string, unknown> = {}
    if (input.text !== undefined) patch.text = input.text.trim() || 'Criterion'
    if (input.responseType !== undefined || input.choiceOptions !== undefined) {
      const [current] = await tx
        .select({
          responseType: inspectionBankCriteria.responseType,
          choiceOptions: inspectionBankCriteria.choiceOptions,
        })
        .from(inspectionBankCriteria)
        .where(eq(inspectionBankCriteria.id, input.id))
        .limit(1)
      if (!current) throw new Error('Criterion not found')
      const response = parseInspectionResponseConfig(
        input.responseType ?? current.responseType,
        input.choiceOptions ?? current.choiceOptions,
      )
      patch.responseType = response.responseType
      patch.choiceOptions = response.choiceOptions
    }
    if (input.requiresPhoto !== undefined) patch.requiresPhoto = input.requiresPhoto
    if (input.requiresComment !== undefined) patch.requiresComment = input.requiresComment
    if (Object.keys(patch).length > 0) {
      await tx
        .update(inspectionBankCriteria)
        .set(patch)
        .where(eq(inspectionBankCriteria.id, input.id))
    }
  })
  revalidateBank(input.bankId)
}

export async function deleteBankCriterion(input: { bankId: string; id: string }) {
  const ctx = await manageCtx()
  await ctx.db((tx) =>
    tx.delete(inspectionBankCriteria).where(eq(inspectionBankCriteria.id, input.id)),
  )
  await recordAudit(ctx, {
    entityType: 'inspection_bank',
    entityId: input.bankId,
    action: 'update',
    summary: 'Removed a criterion',
  })
  revalidateBank(input.bankId)
}

export async function reorderBankCriteria(input: { bankId: string; ids: string[] }) {
  const ctx = await manageCtx()
  await ctx.db(async (tx) => {
    for (let i = 0; i < input.ids.length; i++) {
      await tx
        .update(inspectionBankCriteria)
        .set({ sequence: i })
        .where(eq(inspectionBankCriteria.id, input.ids[i]!))
    }
  })
  revalidateBank(input.bankId)
}
