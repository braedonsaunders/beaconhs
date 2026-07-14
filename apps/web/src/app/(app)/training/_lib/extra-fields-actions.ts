'use server'

// Mutations for training record/type/authority additional fields. Physical
// owner foreign keys enforce tenant integrity and cascade cleanup; the action
// policy still validates every remotely callable input before opening a
// transaction so callers receive useful errors instead of database failures.

import { and, eq, type SQL } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import type { Database } from '@beaconhs/db'
import {
  trainingExtraFields,
  trainingSkillAssignments,
  trainingSkillAuthorities,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAuditInTransaction } from '@/lib/audit'
import {
  parseDeleteExtraFieldInput,
  parseExtraFieldInput,
  type TrainingExtraFieldOwnerType as OwnerType,
} from './extra-field-policy'

function ownerPath(type: OwnerType, id: string): string {
  switch (type) {
    case 'skill':
      return `/training/skills/${id}`
    case 'skill_type':
      return `/training/skills/types/${id}`
    case 'authority':
      return `/training/authorities/${id}`
  }
}

function ownerAuditEntity(type: OwnerType): string {
  switch (type) {
    case 'skill':
      return 'training_skill'
    case 'skill_type':
      return 'training_skill_type'
    case 'authority':
      return 'training_skill_authority'
  }
}

function ownerValues(
  type: OwnerType,
  id: string,
): {
  skillAssignmentId?: string
  skillTypeId?: string
  authorityId?: string
} {
  switch (type) {
    case 'skill':
      return { skillAssignmentId: id }
    case 'skill_type':
      return { skillTypeId: id }
    case 'authority':
      return { authorityId: id }
  }
}

function ownerWhere(type: OwnerType, id: string): SQL {
  switch (type) {
    case 'skill':
      return eq(trainingExtraFields.skillAssignmentId, id)
    case 'skill_type':
      return eq(trainingExtraFields.skillTypeId, id)
    case 'authority':
      return eq(trainingExtraFields.authorityId, id)
  }
}

async function ownerExists(
  tx: Database,
  tenantId: string,
  type: OwnerType,
  id: string,
): Promise<boolean> {
  switch (type) {
    case 'skill': {
      const [row] = await tx
        .select({ id: trainingSkillAssignments.id })
        .from(trainingSkillAssignments)
        .where(
          and(eq(trainingSkillAssignments.id, id), eq(trainingSkillAssignments.tenantId, tenantId)),
        )
        .limit(1)
        .for('share')
      return Boolean(row)
    }
    case 'skill_type': {
      const [row] = await tx
        .select({ id: trainingSkillTypes.id })
        .from(trainingSkillTypes)
        .where(and(eq(trainingSkillTypes.id, id), eq(trainingSkillTypes.tenantId, tenantId)))
        .limit(1)
        .for('share')
      return Boolean(row)
    }
    case 'authority': {
      const [row] = await tx
        .select({ id: trainingSkillAuthorities.id })
        .from(trainingSkillAuthorities)
        .where(
          and(eq(trainingSkillAuthorities.id, id), eq(trainingSkillAuthorities.tenantId, tenantId)),
        )
        .limit(1)
        .for('share')
      return Boolean(row)
    }
  }
}

export async function addExtraField(input: {
  ownerType: OwnerType
  ownerId: string
  fieldKey: string
  fieldValue: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')

  let parsed: ReturnType<typeof parseExtraFieldInput>
  try {
    parsed = parseExtraFieldInput(input)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid field.' }
  }

  const result = await ctx.db(async (tx) => {
    if (!(await ownerExists(tx, ctx.tenantId, parsed.ownerType, parsed.ownerId))) {
      return { ok: false as const, error: 'The training record no longer exists.' }
    }
    const [row] = await tx
      .insert(trainingExtraFields)
      .values({
        tenantId: ctx.tenantId,
        ...ownerValues(parsed.ownerType, parsed.ownerId),
        fieldKey: parsed.fieldKey,
        fieldValue: parsed.fieldValue,
      })
      .onConflictDoNothing()
      .returning({ id: trainingExtraFields.id })
    if (!row) {
      return { ok: false as const, error: 'That field name already exists on this record.' }
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: ownerAuditEntity(parsed.ownerType),
      entityId: parsed.ownerId,
      action: 'update',
      summary: `Added additional field "${parsed.fieldKey}"`,
      after: { fieldKey: parsed.fieldKey, fieldValue: parsed.fieldValue },
    })
    return { ok: true as const }
  })
  if (result.ok) revalidatePath(ownerPath(parsed.ownerType, parsed.ownerId))
  return result
}

export async function deleteExtraField(input: {
  id: string
  ownerType: OwnerType
  ownerId: string
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')

  let parsed: ReturnType<typeof parseDeleteExtraFieldInput>
  try {
    parsed = parseDeleteExtraFieldInput(input)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid field.' }
  }

  const result = await ctx.db(async (tx) => {
    const predicate = and(
      eq(trainingExtraFields.id, parsed.id),
      eq(trainingExtraFields.tenantId, ctx.tenantId),
      ownerWhere(parsed.ownerType, parsed.ownerId),
    )
    const [existing] = await tx
      .select({
        id: trainingExtraFields.id,
        fieldKey: trainingExtraFields.fieldKey,
        fieldValue: trainingExtraFields.fieldValue,
      })
      .from(trainingExtraFields)
      .where(predicate)
      .limit(1)
      .for('update')
    if (!existing) return { ok: false as const, error: 'Field not found.' }

    const [deleted] = await tx
      .delete(trainingExtraFields)
      .where(predicate)
      .returning({ id: trainingExtraFields.id })
    if (!deleted) return { ok: false as const, error: 'Field could not be deleted.' }
    await recordAuditInTransaction(tx, ctx, {
      entityType: ownerAuditEntity(parsed.ownerType),
      entityId: parsed.ownerId,
      action: 'delete',
      summary: `Removed additional field "${existing.fieldKey}"`,
      before: { fieldKey: existing.fieldKey, fieldValue: existing.fieldValue },
    })
    return { ok: true as const }
  })
  if (result.ok) revalidatePath(ownerPath(parsed.ownerType, parsed.ownerId))
  return result
}
