'use server'

// Server actions for the inspection TYPE builder. A type owns its criteria
// directly, organised into groups; banks are only an import source.
//
// These take typed object args (not FormData) — the builder is a client
// component that calls them imperatively inside a transition.

import { revalidatePath } from 'next/cache'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import {
  inspectionBankCriteria,
  inspectionBanks,
  inspectionTypeCriteria,
  inspectionTypeGroups,
  inspectionTypes,
} from '@beaconhs/db/schema'
import { assertComplianceTargetCanRetire } from '@beaconhs/compliance'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit, recordAuditInTransaction } from '@/lib/audit'
import { parseInspectionResponseConfig } from '@/lib/inspection-response-config'

async function manageCtx() {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'inspections')
  return ctx
}

function revalidateType(id: string) {
  revalidatePath(`/inspections/types/${id}`)
  revalidatePath('/inspections/types')
}

// --- type settings ---------------------------------------------------------

export async function updateInspectionType(input: {
  id: string
  name: string
  description: string | null
  defaultCadence: string | null
  requiresForeman: boolean
  requiresCustomerSignature: boolean
  enableCorrectiveActions: boolean
  allowCompliantNotes: boolean
}) {
  // Note: publish state is owned by toggleInspectionTypePublished, not here.
  const ctx = await manageCtx()
  const name = input.name.trim()
  if (!name) throw new Error('Name is required')
  await ctx.db((tx) =>
    tx
      .update(inspectionTypes)
      .set({
        name,
        description: input.description?.trim() || null,
        defaultCadence: input.defaultCadence?.trim() || null,
        requiresForeman: input.requiresForeman,
        requiresCustomerSignature: input.requiresCustomerSignature,
        enableCorrectiveActions: input.enableCorrectiveActions,
        allowCompliantNotes: input.allowCompliantNotes,
      })
      .where(eq(inspectionTypes.id, input.id)),
  )
  await recordAudit(ctx, {
    entityType: 'inspection_type',
    entityId: input.id,
    action: 'update',
    summary: 'Type details updated',
  })
  revalidateType(input.id)
}

export async function deleteInspectionType(input: { id: string }) {
  const ctx = await manageCtx()
  await ctx.db(async (tx) => {
    const [type] = await tx
      .select({ id: inspectionTypes.id })
      .from(inspectionTypes)
      .where(
        and(
          eq(inspectionTypes.tenantId, ctx.tenantId),
          eq(inspectionTypes.id, input.id),
          isNull(inspectionTypes.deletedAt),
        ),
      )
      .limit(1)
      .for('update')
    if (!type) throw new Error('Inspection type not found')
    await assertComplianceTargetCanRetire(tx, ctx.tenantId, 'inspection_type', input.id)
    await tx
      .update(inspectionTypes)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(inspectionTypes.tenantId, ctx.tenantId),
          eq(inspectionTypes.id, input.id),
          isNull(inspectionTypes.deletedAt),
        ),
      )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'inspection_type',
      entityId: input.id,
      action: 'delete',
      summary: 'Deleted inspection type',
    })
  })
  revalidatePath('/inspections/types')
}

export async function toggleInspectionTypePublished(input: { id: string; next: boolean }) {
  const ctx = await manageCtx()
  await ctx.db(async (tx) => {
    const [type] = await tx
      .select({ id: inspectionTypes.id })
      .from(inspectionTypes)
      .where(
        and(
          eq(inspectionTypes.tenantId, ctx.tenantId),
          eq(inspectionTypes.id, input.id),
          isNull(inspectionTypes.deletedAt),
        ),
      )
      .limit(1)
      .for('update')
    if (!type) throw new Error('Inspection type not found')
    if (!input.next) {
      await assertComplianceTargetCanRetire(tx, ctx.tenantId, 'inspection_type', input.id)
    }
    await tx
      .update(inspectionTypes)
      .set({ isPublished: input.next })
      .where(
        and(
          eq(inspectionTypes.tenantId, ctx.tenantId),
          eq(inspectionTypes.id, input.id),
          isNull(inspectionTypes.deletedAt),
        ),
      )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'inspection_type',
      entityId: input.id,
      action: input.next ? 'publish' : 'update',
      summary: input.next ? 'Published' : 'Moved back to draft',
    })
  })
  revalidateType(input.id)
}

// --- groups ----------------------------------------------------------------

export async function addTypeGroup(input: { typeId: string; label?: string }) {
  const ctx = await manageCtx()
  const id = await ctx.db(async (tx) => {
    const [maxRow] = await tx
      .select({
        m: sql<number>`coalesce(max(${inspectionTypeGroups.sequence}), -1)`.mapWith(Number),
      })
      .from(inspectionTypeGroups)
      .where(eq(inspectionTypeGroups.typeId, input.typeId))
    const [row] = await tx
      .insert(inspectionTypeGroups)
      .values({
        tenantId: ctx.tenantId,
        typeId: input.typeId,
        sequence: Number(maxRow?.m ?? -1) + 1,
        label: input.label?.trim() || 'New section',
      })
      .returning({ id: inspectionTypeGroups.id })
    return row?.id
  })
  await recordAudit(ctx, {
    entityType: 'inspection_type',
    entityId: input.typeId,
    action: 'update',
    summary: 'Added a criteria group',
  })
  revalidateType(input.typeId)
  return { id }
}

export async function renameTypeGroup(input: { typeId: string; id: string; label: string }) {
  const ctx = await manageCtx()
  await ctx.db((tx) =>
    tx
      .update(inspectionTypeGroups)
      .set({ label: input.label.trim() || 'Section' })
      .where(eq(inspectionTypeGroups.id, input.id)),
  )
  revalidateType(input.typeId)
}

export async function deleteTypeGroup(input: { typeId: string; id: string }) {
  const ctx = await manageCtx()
  await ctx.db(async (tx) => {
    // Keep the criteria — just move them back to "ungrouped" (FK is set null,
    // but be explicit so the rows resurface in the ungrouped section).
    await tx
      .update(inspectionTypeCriteria)
      .set({ groupId: null })
      .where(eq(inspectionTypeCriteria.groupId, input.id))
    await tx.delete(inspectionTypeGroups).where(eq(inspectionTypeGroups.id, input.id))
  })
  await recordAudit(ctx, {
    entityType: 'inspection_type',
    entityId: input.typeId,
    action: 'update',
    summary: 'Removed a criteria group',
  })
  revalidateType(input.typeId)
}

export async function reorderTypeGroups(input: { typeId: string; ids: string[] }) {
  const ctx = await manageCtx()
  await ctx.db(async (tx) => {
    for (let i = 0; i < input.ids.length; i++) {
      await tx
        .update(inspectionTypeGroups)
        .set({ sequence: i })
        .where(eq(inspectionTypeGroups.id, input.ids[i]!))
    }
  })
  revalidateType(input.typeId)
}

// --- criteria --------------------------------------------------------------

export async function addTypeCriterion(input: {
  typeId: string
  groupId: string | null
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
        m: sql<number>`coalesce(max(${inspectionTypeCriteria.sequence}), -1)`.mapWith(Number),
      })
      .from(inspectionTypeCriteria)
      .where(
        and(
          eq(inspectionTypeCriteria.typeId, input.typeId),
          input.groupId
            ? eq(inspectionTypeCriteria.groupId, input.groupId)
            : isNull(inspectionTypeCriteria.groupId),
        ),
      )
    const seq = Number(maxRow?.m ?? -1) + 1
    const [row] = await tx
      .insert(inspectionTypeCriteria)
      .values({
        tenantId: ctx.tenantId,
        typeId: input.typeId,
        groupId: input.groupId,
        sequence: seq,
        text,
        responseType: response.responseType,
        choiceOptions: response.choiceOptions,
        requiresPhoto: Boolean(input.requiresPhoto),
        requiresComment: Boolean(input.requiresComment),
      })
      .returning({ id: inspectionTypeCriteria.id })
    return row?.id
  })
  await recordAudit(ctx, {
    entityType: 'inspection_type',
    entityId: input.typeId,
    action: 'update',
    summary: `Added criterion: "${text.slice(0, 60)}"`,
  })
  revalidateType(input.typeId)
  return { id }
}

export async function updateTypeCriterion(input: {
  typeId: string
  id: string
  text?: string
  responseType?: string
  choiceOptions?: string[]
  requiresPhoto?: boolean
  requiresComment?: boolean
  groupId?: string | null
}) {
  const ctx = await manageCtx()
  await ctx.db(async (tx) => {
    const patch: Record<string, unknown> = {}
    if (input.text !== undefined) patch.text = input.text.trim() || 'Criterion'
    if (input.responseType !== undefined || input.choiceOptions !== undefined) {
      const [current] = await tx
        .select({
          responseType: inspectionTypeCriteria.responseType,
          choiceOptions: inspectionTypeCriteria.choiceOptions,
        })
        .from(inspectionTypeCriteria)
        .where(eq(inspectionTypeCriteria.id, input.id))
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
    // Moving to a different group appends to the end of that group.
    if (input.groupId !== undefined) {
      const [cur] = await tx
        .select({ groupId: inspectionTypeCriteria.groupId })
        .from(inspectionTypeCriteria)
        .where(eq(inspectionTypeCriteria.id, input.id))
        .limit(1)
      if (cur && (cur.groupId ?? null) !== (input.groupId ?? null)) {
        const [maxRow] = await tx
          .select({
            m: sql<number>`coalesce(max(${inspectionTypeCriteria.sequence}), -1)`.mapWith(Number),
          })
          .from(inspectionTypeCriteria)
          .where(
            and(
              eq(inspectionTypeCriteria.typeId, input.typeId),
              input.groupId
                ? eq(inspectionTypeCriteria.groupId, input.groupId)
                : isNull(inspectionTypeCriteria.groupId),
            ),
          )
        patch.groupId = input.groupId
        patch.sequence = Number(maxRow?.m ?? -1) + 1
      }
    }
    if (Object.keys(patch).length > 0) {
      await tx
        .update(inspectionTypeCriteria)
        .set(patch)
        .where(eq(inspectionTypeCriteria.id, input.id))
    }
  })
  revalidateType(input.typeId)
}

export async function deleteTypeCriterion(input: { typeId: string; id: string }) {
  const ctx = await manageCtx()
  await ctx.db((tx) =>
    tx.delete(inspectionTypeCriteria).where(eq(inspectionTypeCriteria.id, input.id)),
  )
  await recordAudit(ctx, {
    entityType: 'inspection_type',
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
        .update(inspectionTypeCriteria)
        .set({ sequence: i, groupId: input.groupId })
        .where(eq(inspectionTypeCriteria.id, input.ids[i]!))
    }
  })
  revalidateType(input.typeId)
}

// --- import from bank ------------------------------------------------------

export async function importBankIntoType(input: { typeId: string; bankId: string }) {
  const ctx = await manageCtx()
  const result = await ctx.db(async (tx) => {
    const [bank] = await tx
      .select({ id: inspectionBanks.id, name: inspectionBanks.name })
      .from(inspectionBanks)
      .where(eq(inspectionBanks.id, input.bankId))
      .limit(1)
    if (!bank) throw new Error('Bank not found')
    const criteria = await tx
      .select()
      .from(inspectionBankCriteria)
      .where(eq(inspectionBankCriteria.bankId, input.bankId))
      .orderBy(asc(inspectionBankCriteria.sequence))

    const [maxRow] = await tx
      .select({
        m: sql<number>`coalesce(max(${inspectionTypeGroups.sequence}), -1)`.mapWith(Number),
      })
      .from(inspectionTypeGroups)
      .where(eq(inspectionTypeGroups.typeId, input.typeId))
    const groupSeq = Number(maxRow?.m ?? -1) + 1
    const [group] = await tx
      .insert(inspectionTypeGroups)
      .values({
        tenantId: ctx.tenantId,
        typeId: input.typeId,
        sequence: groupSeq,
        label: bank.name,
      })
      .returning({ id: inspectionTypeGroups.id })

    const insertedCriteria =
      group && criteria.length > 0
        ? await tx
            .insert(inspectionTypeCriteria)
            .values(
              criteria.map((c, i) => ({
                tenantId: ctx.tenantId,
                typeId: input.typeId,
                groupId: group.id,
                sequence: i,
                text: c.text,
                responseType: c.responseType,
                choiceOptions: c.choiceOptions,
                requiresPhoto: c.requiresPhoto,
                requiresComment: c.requiresComment,
                sourceBankId: input.bankId,
                sourceBankCriterionId: c.id,
              })),
            )
            .returning({
              id: inspectionTypeCriteria.id,
              groupId: inspectionTypeCriteria.groupId,
              sequence: inspectionTypeCriteria.sequence,
              text: inspectionTypeCriteria.text,
              responseType: inspectionTypeCriteria.responseType,
              choiceOptions: inspectionTypeCriteria.choiceOptions,
              requiresPhoto: inspectionTypeCriteria.requiresPhoto,
              requiresComment: inspectionTypeCriteria.requiresComment,
            })
        : []
    return {
      group: group ? { id: group.id, label: bank.name, sequence: groupSeq } : null,
      criteria: insertedCriteria,
      bankName: bank.name,
    }
  })
  await recordAudit(ctx, {
    entityType: 'inspection_type',
    entityId: input.typeId,
    action: 'update',
    summary: `Imported ${result.criteria.length} criteria from bank "${result.bankName}"`,
  })
  revalidateType(input.typeId)
  return result
}
