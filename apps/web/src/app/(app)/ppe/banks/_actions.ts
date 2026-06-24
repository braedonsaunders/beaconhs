'use server'

// Server actions for the PPE criteria BANK builder. A bank is a flat, reusable,
// severity-aware pool of criteria that PPE types import from. Typed object args
// — called from the client builder inside a transition.

import { revalidatePath } from 'next/cache'
import { eq, sql } from 'drizzle-orm'
import { ppeCriteriaBankCriteria, ppeCriteriaBanks } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
type Severity = (typeof SEVERITIES)[number]
function parseSeverity(v: unknown): Severity {
  return typeof v === 'string' && (SEVERITIES as readonly string[]).includes(v)
    ? (v as Severity)
    : 'medium'
}

async function manageCtx() {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'ppe')
  return ctx
}

function revalidateBank(id: string) {
  revalidatePath(`/ppe/banks/${id}`)
  revalidatePath('/ppe/banks')
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
      .update(ppeCriteriaBanks)
      .set({
        name,
        description: input.description?.trim() || null,
        category: input.category?.trim() || null,
      })
      .where(eq(ppeCriteriaBanks.id, input.id)),
  )
  await recordAudit(ctx, {
    entityType: 'ppe_criteria_bank',
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
      .update(ppeCriteriaBanks)
      .set({ isPublished: input.next })
      .where(eq(ppeCriteriaBanks.id, input.id)),
  )
  await recordAudit(ctx, {
    entityType: 'ppe_criteria_bank',
    entityId: input.id,
    action: input.next ? 'publish' : 'update',
    summary: input.next ? 'Published' : 'Moved back to draft',
  })
  revalidateBank(input.id)
}

export async function addBankCriterion(input: {
  bankId: string
  question: string
  description?: string | null
  severity?: string
  requiresPhoto?: boolean
}) {
  const ctx = await manageCtx()
  const question = input.question.trim()
  if (!question) throw new Error('Question is required')
  const id = await ctx.db(async (tx) => {
    const [maxRow] = await tx
      .select({
        m: sql<number>`coalesce(max(${ppeCriteriaBankCriteria.sequence}), -1)`.mapWith(Number),
      })
      .from(ppeCriteriaBankCriteria)
      .where(eq(ppeCriteriaBankCriteria.bankId, input.bankId))
    const [row] = await tx
      .insert(ppeCriteriaBankCriteria)
      .values({
        tenantId: ctx.tenantId,
        bankId: input.bankId,
        sequence: Number(maxRow?.m ?? -1) + 1,
        question,
        description: input.description?.trim() || null,
        severity: parseSeverity(input.severity),
        requiresPhoto: Boolean(input.requiresPhoto),
      })
      .returning({ id: ppeCriteriaBankCriteria.id })
    return row?.id
  })
  await recordAudit(ctx, {
    entityType: 'ppe_criteria_bank',
    entityId: input.bankId,
    action: 'update',
    summary: `Added criterion: "${question.slice(0, 60)}"`,
  })
  revalidateBank(input.bankId)
  return { id }
}

export async function updateBankCriterion(input: {
  bankId: string
  id: string
  question?: string
  description?: string | null
  severity?: string
  requiresPhoto?: boolean
}) {
  const ctx = await manageCtx()
  const patch: Record<string, unknown> = {}
  if (input.question !== undefined) patch.question = input.question.trim() || 'Criterion'
  if (input.description !== undefined) patch.description = input.description?.trim() || null
  if (input.severity !== undefined) patch.severity = parseSeverity(input.severity)
  if (input.requiresPhoto !== undefined) patch.requiresPhoto = input.requiresPhoto
  if (Object.keys(patch).length > 0) {
    await ctx.db((tx) =>
      tx.update(ppeCriteriaBankCriteria).set(patch).where(eq(ppeCriteriaBankCriteria.id, input.id)),
    )
  }
  revalidateBank(input.bankId)
}

export async function deleteBankCriterion(input: { bankId: string; id: string }) {
  const ctx = await manageCtx()
  await ctx.db((tx) =>
    tx.delete(ppeCriteriaBankCriteria).where(eq(ppeCriteriaBankCriteria.id, input.id)),
  )
  await recordAudit(ctx, {
    entityType: 'ppe_criteria_bank',
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
        .update(ppeCriteriaBankCriteria)
        .set({ sequence: i })
        .where(eq(ppeCriteriaBankCriteria.id, input.ids[i]!))
    }
  })
  revalidateBank(input.bankId)
}
