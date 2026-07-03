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

// 'rating' is withdrawn — it never had a fill-flow control. Unknown values
// (including 'rating') fall back to pass_fail_na.
const RESPONSE_TYPES = ['pass_fail_na', 'yes_no'] as const
type ResponseType = (typeof RESPONSE_TYPES)[number]
function parseResponseType(v: unknown): ResponseType {
  return typeof v === 'string' && (RESPONSE_TYPES as readonly string[]).includes(v)
    ? (v as ResponseType)
    : 'pass_fail_na'
}

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
  requiresPhoto?: boolean
  requiresComment?: boolean
}) {
  const ctx = await manageCtx()
  const text = input.text.trim()
  if (!text) throw new Error('Question is required')
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
        responseType: parseResponseType(input.responseType),
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
  requiresPhoto?: boolean
  requiresComment?: boolean
}) {
  const ctx = await manageCtx()
  const patch: Record<string, unknown> = {}
  if (input.text !== undefined) patch.text = input.text.trim() || 'Criterion'
  if (input.responseType !== undefined) patch.responseType = parseResponseType(input.responseType)
  if (input.requiresPhoto !== undefined) patch.requiresPhoto = input.requiresPhoto
  if (input.requiresComment !== undefined) patch.requiresComment = input.requiresComment
  if (Object.keys(patch).length > 0) {
    await ctx.db((tx) =>
      tx.update(inspectionBankCriteria).set(patch).where(eq(inspectionBankCriteria.id, input.id)),
    )
  }
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
