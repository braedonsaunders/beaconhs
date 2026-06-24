'use server'

// Server actions for the PPE TYPE builder. A type owns its criteria directly,
// organised into kind-scoped groups (pre-use / annual each have their own
// sections); banks are only an import source. Criteria carry PPE's severity +
// requires-photo, preserved through the bank import snapshot.
//
// Typed object args (not FormData) — the builder is a client component that
// calls them imperatively inside a transition.

import { revalidatePath } from 'next/cache'
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm'
import {
  ppeCriteriaBankCriteria,
  ppeCriteriaBanks,
  ppeItems,
  ppeTypeCriteriaGroups,
  ppeTypeInspectionCriteria,
  ppeTypes,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'

type Kind = 'pre_use' | 'annual'
type Severity = 'low' | 'medium' | 'high' | 'critical'
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
function parseKind(v: unknown): Kind {
  return v === 'annual' ? 'annual' : 'pre_use'
}
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

function revalidateType(id: string) {
  revalidatePath(`/ppe/types/${id}`)
  revalidatePath('/ppe/types')
}

// --- type settings ---------------------------------------------------------

export async function updateType(input: {
  id: string
  name: string
  category: string | null
  isInspectable: boolean
  everyDays: number | null
  sizingScheme: string[] | null
}) {
  const ctx = await manageCtx()
  const name = input.name.trim()
  if (!name) throw new Error('Name is required')
  await ctx.db((tx) =>
    tx
      .update(ppeTypes)
      .set({
        name,
        category: input.category?.trim() || null,
        isInspectable: input.isInspectable,
        inspectionSchedule:
          input.isInspectable && input.everyDays ? { everyDays: input.everyDays } : null,
        sizingScheme:
          input.sizingScheme && input.sizingScheme.length > 0 ? input.sizingScheme : null,
      })
      .where(eq(ppeTypes.id, input.id)),
  )
  await recordAudit(ctx, {
    entityType: 'ppe_type',
    entityId: input.id,
    action: 'update',
    summary: `Updated PPE type "${name}"`,
    after: { name, category: input.category, isInspectable: input.isInspectable },
  })
  revalidateType(input.id)
}

export async function deleteType(input: { id: string }) {
  const ctx = await manageCtx()
  const [tally] = await ctx.db((tx) =>
    tx.select({ c: count() }).from(ppeItems).where(eq(ppeItems.typeId, input.id)),
  )
  if (Number(tally?.c ?? 0) > 0) {
    throw new Error(`Cannot delete — ${tally?.c} item(s) reference this type`)
  }
  await ctx.db((tx) => tx.delete(ppeTypes).where(eq(ppeTypes.id, input.id)))
  await recordAudit(ctx, {
    entityType: 'ppe_type',
    entityId: input.id,
    action: 'delete',
    summary: 'Deleted PPE type',
  })
  revalidatePath('/ppe/types')
}

// --- groups (kind-scoped sections) -----------------------------------------

export async function addTypeGroup(input: { typeId: string; kind: string; label?: string }) {
  const ctx = await manageCtx()
  const kind = parseKind(input.kind)
  const id = await ctx.db(async (tx) => {
    const [maxRow] = await tx
      .select({
        m: sql<number>`coalesce(max(${ppeTypeCriteriaGroups.sequence}), -1)`.mapWith(Number),
      })
      .from(ppeTypeCriteriaGroups)
      .where(
        and(
          eq(ppeTypeCriteriaGroups.ppeTypeId, input.typeId),
          eq(ppeTypeCriteriaGroups.inspectionKind, kind),
        ),
      )
    const [row] = await tx
      .insert(ppeTypeCriteriaGroups)
      .values({
        tenantId: ctx.tenantId,
        ppeTypeId: input.typeId,
        inspectionKind: kind,
        sequence: Number(maxRow?.m ?? -1) + 1,
        label: input.label?.trim() || 'New section',
      })
      .returning({ id: ppeTypeCriteriaGroups.id })
    return row?.id
  })
  await recordAudit(ctx, {
    entityType: 'ppe_type',
    entityId: input.typeId,
    action: 'update',
    summary: 'Added a criteria section',
  })
  revalidateType(input.typeId)
  return { id }
}

export async function renameTypeGroup(input: { typeId: string; id: string; label: string }) {
  const ctx = await manageCtx()
  await ctx.db((tx) =>
    tx
      .update(ppeTypeCriteriaGroups)
      .set({ label: input.label.trim() || 'Section' })
      .where(eq(ppeTypeCriteriaGroups.id, input.id)),
  )
  revalidateType(input.typeId)
}

export async function deleteTypeGroup(input: { typeId: string; id: string }) {
  const ctx = await manageCtx()
  await ctx.db(async (tx) => {
    // Keep the criteria — orphan them back to "Ungrouped".
    await tx
      .update(ppeTypeInspectionCriteria)
      .set({ groupId: null })
      .where(eq(ppeTypeInspectionCriteria.groupId, input.id))
    await tx.delete(ppeTypeCriteriaGroups).where(eq(ppeTypeCriteriaGroups.id, input.id))
  })
  await recordAudit(ctx, {
    entityType: 'ppe_type',
    entityId: input.typeId,
    action: 'update',
    summary: 'Removed a criteria section',
  })
  revalidateType(input.typeId)
}

export async function reorderTypeGroups(input: { typeId: string; kind: string; ids: string[] }) {
  const ctx = await manageCtx()
  await ctx.db(async (tx) => {
    for (let i = 0; i < input.ids.length; i++) {
      await tx
        .update(ppeTypeCriteriaGroups)
        .set({ sequence: i })
        .where(eq(ppeTypeCriteriaGroups.id, input.ids[i]!))
    }
  })
  revalidateType(input.typeId)
}

// --- criteria --------------------------------------------------------------

export async function addTypeCriterion(input: {
  typeId: string
  kind: string
  groupId: string | null
  question: string
  description?: string | null
  severity?: string
  requiresPhoto?: boolean
}) {
  const ctx = await manageCtx()
  const kind = parseKind(input.kind)
  const question = input.question.trim()
  if (!question) throw new Error('Question is required')
  const id = await ctx.db(async (tx) => {
    const [maxRow] = await tx
      .select({
        m: sql<number>`coalesce(max(${ppeTypeInspectionCriteria.entityOrder}), -1)`.mapWith(Number),
      })
      .from(ppeTypeInspectionCriteria)
      .where(
        and(
          eq(ppeTypeInspectionCriteria.ppeTypeId, input.typeId),
          eq(ppeTypeInspectionCriteria.inspectionKind, kind),
          input.groupId
            ? eq(ppeTypeInspectionCriteria.groupId, input.groupId)
            : isNull(ppeTypeInspectionCriteria.groupId),
        ),
      )
    const [row] = await tx
      .insert(ppeTypeInspectionCriteria)
      .values({
        tenantId: ctx.tenantId,
        ppeTypeId: input.typeId,
        groupId: input.groupId,
        inspectionKind: kind,
        question,
        description: input.description?.trim() || null,
        severity: parseSeverity(input.severity),
        requiresPhoto: Boolean(input.requiresPhoto),
        entityOrder: Number(maxRow?.m ?? -1) + 1,
      })
      .returning({ id: ppeTypeInspectionCriteria.id })
    return row?.id
  })
  await recordAudit(ctx, {
    entityType: 'ppe_type',
    entityId: input.typeId,
    action: 'update',
    summary: `Added criterion: "${question.slice(0, 60)}"`,
  })
  revalidateType(input.typeId)
  return { id }
}

export async function updateTypeCriterion(input: {
  typeId: string
  kind: string
  id: string
  question?: string
  description?: string | null
  severity?: string
  requiresPhoto?: boolean
  groupId?: string | null
}) {
  const ctx = await manageCtx()
  const kind = parseKind(input.kind)
  await ctx.db(async (tx) => {
    const patch: Record<string, unknown> = {}
    if (input.question !== undefined) patch.question = input.question.trim() || 'Criterion'
    if (input.description !== undefined) patch.description = input.description?.trim() || null
    if (input.severity !== undefined) patch.severity = parseSeverity(input.severity)
    if (input.requiresPhoto !== undefined) patch.requiresPhoto = input.requiresPhoto
    // Moving to a different section appends to the end of that section.
    if (input.groupId !== undefined) {
      const [cur] = await tx
        .select({ groupId: ppeTypeInspectionCriteria.groupId })
        .from(ppeTypeInspectionCriteria)
        .where(eq(ppeTypeInspectionCriteria.id, input.id))
        .limit(1)
      if (cur && (cur.groupId ?? null) !== (input.groupId ?? null)) {
        const [maxRow] = await tx
          .select({
            m: sql<number>`coalesce(max(${ppeTypeInspectionCriteria.entityOrder}), -1)`.mapWith(
              Number,
            ),
          })
          .from(ppeTypeInspectionCriteria)
          .where(
            and(
              eq(ppeTypeInspectionCriteria.ppeTypeId, input.typeId),
              eq(ppeTypeInspectionCriteria.inspectionKind, kind),
              input.groupId
                ? eq(ppeTypeInspectionCriteria.groupId, input.groupId)
                : isNull(ppeTypeInspectionCriteria.groupId),
            ),
          )
        patch.groupId = input.groupId
        patch.entityOrder = Number(maxRow?.m ?? -1) + 1
      }
    }
    if (Object.keys(patch).length > 0) {
      await tx
        .update(ppeTypeInspectionCriteria)
        .set(patch)
        .where(eq(ppeTypeInspectionCriteria.id, input.id))
    }
  })
  revalidateType(input.typeId)
}

export async function deleteTypeCriterion(input: { typeId: string; id: string }) {
  const ctx = await manageCtx()
  await ctx.db((tx) =>
    tx.delete(ppeTypeInspectionCriteria).where(eq(ppeTypeInspectionCriteria.id, input.id)),
  )
  await recordAudit(ctx, {
    entityType: 'ppe_type',
    entityId: input.typeId,
    action: 'update',
    summary: 'Removed a criterion',
  })
  revalidateType(input.typeId)
}

export async function reorderTypeCriteria(input: {
  typeId: string
  groupId: string | null
  ids: string[]
}) {
  const ctx = await manageCtx()
  await ctx.db(async (tx) => {
    for (let i = 0; i < input.ids.length; i++) {
      await tx
        .update(ppeTypeInspectionCriteria)
        .set({ entityOrder: i, groupId: input.groupId })
        .where(eq(ppeTypeInspectionCriteria.id, input.ids[i]!))
    }
  })
  revalidateType(input.typeId)
}

// --- import from a PPE criteria bank ----------------------------------------

export async function importBankIntoType(input: { typeId: string; bankId: string; kind: string }) {
  const ctx = await manageCtx()
  const kind = parseKind(input.kind)
  const result = await ctx.db(async (tx) => {
    const [bank] = await tx
      .select({ id: ppeCriteriaBanks.id, name: ppeCriteriaBanks.name })
      .from(ppeCriteriaBanks)
      .where(eq(ppeCriteriaBanks.id, input.bankId))
      .limit(1)
    if (!bank) throw new Error('Bank not found')
    const criteria = await tx
      .select()
      .from(ppeCriteriaBankCriteria)
      .where(eq(ppeCriteriaBankCriteria.bankId, input.bankId))
      .orderBy(asc(ppeCriteriaBankCriteria.sequence))

    const [maxRow] = await tx
      .select({
        m: sql<number>`coalesce(max(${ppeTypeCriteriaGroups.sequence}), -1)`.mapWith(Number),
      })
      .from(ppeTypeCriteriaGroups)
      .where(
        and(
          eq(ppeTypeCriteriaGroups.ppeTypeId, input.typeId),
          eq(ppeTypeCriteriaGroups.inspectionKind, kind),
        ),
      )
    const groupSeq = Number(maxRow?.m ?? -1) + 1
    const [group] = await tx
      .insert(ppeTypeCriteriaGroups)
      .values({
        tenantId: ctx.tenantId,
        ppeTypeId: input.typeId,
        inspectionKind: kind,
        sequence: groupSeq,
        label: bank.name,
      })
      .returning({ id: ppeTypeCriteriaGroups.id })

    const insertedCriteria =
      group && criteria.length > 0
        ? await tx
            .insert(ppeTypeInspectionCriteria)
            .values(
              criteria.map((c, i) => ({
                tenantId: ctx.tenantId,
                ppeTypeId: input.typeId,
                groupId: group.id,
                inspectionKind: kind,
                entityOrder: i,
                question: c.question,
                description: c.description,
                severity: c.severity,
                requiresPhoto: c.requiresPhoto,
                sourceBankId: input.bankId,
                sourceBankCriterionId: c.id,
              })),
            )
            .returning({
              id: ppeTypeInspectionCriteria.id,
              groupId: ppeTypeInspectionCriteria.groupId,
              sequence: ppeTypeInspectionCriteria.entityOrder,
              question: ppeTypeInspectionCriteria.question,
              description: ppeTypeInspectionCriteria.description,
              severity: ppeTypeInspectionCriteria.severity,
              requiresPhoto: ppeTypeInspectionCriteria.requiresPhoto,
            })
        : []
    return {
      group: group
        ? { id: group.id, label: bank.name, sequence: groupSeq, inspectionKind: kind }
        : null,
      criteria: insertedCriteria,
      bankName: bank.name,
    }
  })
  await recordAudit(ctx, {
    entityType: 'ppe_type',
    entityId: input.typeId,
    action: 'update',
    summary: `Imported ${result.criteria.length} criteria from bank "${result.bankName}"`,
  })
  revalidateType(input.typeId)
  return result
}
