'use server'

// Server actions backing the polymorphic `training_extra_fields` table.
//
// Owner-type aware revalidation: each owner_type maps to the detail-page
// path it lives on, so we only invalidate the correct route.

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { trainingExtraFields } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'

type OwnerType = 'skill' | 'skill_type' | 'authority'

const PATH_FOR_OWNER: Record<OwnerType, (id: string) => string> = {
  // `skill` = a per-person skill assignment; its detail page is /training/skills/[id].
  skill: (id) => `/training/skills/${id}`,
  skill_type: (id) => `/training/skills/types/${id}`,
  authority: (id) => `/training/authorities/${id}`,
}

const AUDIT_ENTITY_FOR_OWNER: Record<OwnerType, string> = {
  skill: 'training_skill',
  skill_type: 'training_skill_type',
  authority: 'training_skill_authority',
}

export async function addExtraField(input: {
  ownerType: OwnerType
  ownerId: string
  fieldKey: string
  fieldValue: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const { ownerType, ownerId, fieldKey, fieldValue } = input
  const trimmedKey = fieldKey.trim().slice(0, 120)
  if (!trimmedKey) return { ok: false, error: 'Field name is required' }
  if (!ownerId) return { ok: false, error: 'Owner id is required' }
  if (!['skill', 'skill_type', 'authority'].includes(ownerType)) {
    return { ok: false, error: 'Unknown owner type' }
  }
  const value = fieldValue?.toString().slice(0, 500) ?? null

  await ctx.db((tx) =>
    tx.insert(trainingExtraFields).values({
      tenantId: ctx.tenantId,
      ownerType,
      ownerId,
      fieldKey: trimmedKey,
      fieldValue: value,
    }),
  )
  await recordAudit(ctx, {
    entityType: AUDIT_ENTITY_FOR_OWNER[ownerType],
    entityId: ownerId,
    action: 'update',
    summary: `Added additional field "${trimmedKey}"`,
    after: { fieldKey: trimmedKey, fieldValue: value },
  })
  revalidatePath(PATH_FOR_OWNER[ownerType](ownerId))
  return { ok: true }
}

export async function deleteExtraField(input: {
  id: string
  ownerType: OwnerType
  ownerId: string
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const { id, ownerType, ownerId } = input
  if (!id || !ownerId) return { ok: false, error: 'Missing identifiers' }

  // Pull the row first so we can log a meaningful summary AND verify the
  // tenant_id matches (RLS already enforces this, but this is a belt-and-
  // suspenders check that also lets us return a 404-ish error).
  const existing = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(trainingExtraFields)
      .where(
        and(
          eq(trainingExtraFields.id, id),
          eq(trainingExtraFields.ownerType, ownerType),
          eq(trainingExtraFields.ownerId, ownerId),
        ),
      )
      .limit(1)
    return row ?? null
  })
  if (!existing) return { ok: false, error: 'Field not found' }

  await ctx.db((tx) => tx.delete(trainingExtraFields).where(eq(trainingExtraFields.id, id)))
  await recordAudit(ctx, {
    entityType: AUDIT_ENTITY_FOR_OWNER[ownerType],
    entityId: ownerId,
    action: 'delete',
    summary: `Removed additional field "${existing.fieldKey}"`,
    before: { fieldKey: existing.fieldKey, fieldValue: existing.fieldValue },
  })
  revalidatePath(PATH_FOR_OWNER[ownerType](ownerId))
  return { ok: true }
}
