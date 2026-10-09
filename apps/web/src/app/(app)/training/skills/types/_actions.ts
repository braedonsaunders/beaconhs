'use server'

import { assertComplianceTargetCanRetire } from '@beaconhs/compliance'

import { and, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { tenants, trainingSkillAuthorities, trainingSkillTypes } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { recordAuditInTransaction } from '@/lib/audit'
import {
  optionalTextInput,
  requiredTextInput,
  requireEnumInput,
  requireUuidInput,
} from '@/lib/mutation-input'
import {
  optionalTrainingInteger,
  MAX_TRAINING_VALIDITY_MONTHS,
} from '@/lib/training-mutation-validation'
import { normalizeCredentialOutputs } from '@/lib/credential-designs'

export async function createSkillType(formData: FormData): Promise<void> {
  const ctx = await requireModuleManage('training')
  const name = requiredTextInput(formData.get('name'), 'Name', 200)
  const authorityId = requireUuidInput(formData.get('authorityId'), 'Authority')
  const code = optionalTextInput(formData.get('code'), 'Code', 120)
  const description = optionalTextInput(formData.get('description'), 'Description', 5000)
  const validForMonths = optionalTrainingInteger(
    formData.get('validForMonths'),
    'Validity months',
    MAX_TRAINING_VALIDITY_MONTHS,
  )
  const id = await ctx.db(async (tx) => {
    const [authority] = await tx
      .select({ id: trainingSkillAuthorities.id })
      .from(trainingSkillAuthorities)
      .where(eq(trainingSkillAuthorities.id, authorityId))
      .limit(1)
    if (!authority) throw new Error('Authority not found.')
    const [row] = await tx
      .insert(trainingSkillTypes)
      .values({ tenantId: ctx.tenantId, authorityId, name, code, description, validForMonths })
      .returning({ id: trainingSkillTypes.id })
    if (!row) throw new Error('Skill type could not be created.')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_skill_type',
      entityId: row.id,
      action: 'create',
      summary: 'Created skill type',
      after: { name, authorityId },
    })
    return row.id
  })
  revalidatePath('/training/skills/types')
  redirect(`/training/skills/types/${id}`)
}

export async function updateSkillTypeField(formData: FormData): Promise<void> {
  const ctx = await requireModuleManage('training')
  const id = requireUuidInput(formData.get('id'), 'Skill type')
  const field = requireEnumInput(
    formData.get('field'),
    [
      'name',
      'code',
      'description',
      'validForMonths',
      'isActive',
      'viewSource',
      'credentialOutputIds',
    ] as const,
    'Field',
  )
  const raw = formData.get('value')
  const value =
    field === 'name'
      ? requiredTextInput(raw, 'Name', 200)
      : field === 'code'
        ? optionalTextInput(raw, 'Code', 120)
        : field === 'description'
          ? optionalTextInput(raw, 'Description', 5000)
          : field === 'validForMonths'
            ? optionalTrainingInteger(raw, 'Validity months', MAX_TRAINING_VALIDITY_MONTHS)
            : field === 'isActive'
              ? requireEnumInput(raw, ['true', 'false'] as const, 'Active') === 'true'
              : field === 'viewSource'
                ? requireEnumInput(raw, ['evidence', 'generated'] as const, 'View source')
                : requiredTextInput(raw, 'Outputs', 10000)
  await ctx.db(async (tx) => {
    const [before] = await tx
      .select()
      .from(trainingSkillTypes)
      .where(
        and(
          eq(trainingSkillTypes.tenantId, ctx.tenantId),
          eq(trainingSkillTypes.id, id),
          isNull(trainingSkillTypes.deletedAt),
        ),
      )
      .for('update')
      .limit(1)
    if (!before) throw new Error('Skill type not found.')
    if (field === 'isActive' && value === false)
      await assertComplianceTargetCanRetire(tx, ctx.tenantId, 'skill_type', id)
    let outputs: string[] | undefined
    if (field === 'credentialOutputIds') {
      const parsed: unknown = JSON.parse(String(value))
      if (
        !Array.isArray(parsed) ||
        parsed.some((v) => typeof v !== 'string') ||
        parsed.length > 100
      )
        throw new Error('Invalid credential outputs.')
      const [tenant] = await tx
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1)
      const available = new Set(
        normalizeCredentialOutputs(tenant?.settings)
          .filter((o) => o.enabled)
          .map((o) => o.id),
      )
      if (parsed.some((v) => !available.has(String(v))))
        throw new Error('Choose enabled credential designs.')
      outputs = [...new Set(parsed as string[])]
    }
    await tx
      .update(trainingSkillTypes)
      .set({ [field]: outputs ?? value, updatedAt: new Date() })
      .where(and(eq(trainingSkillTypes.tenantId, ctx.tenantId), eq(trainingSkillTypes.id, id)))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_skill_type',
      entityId: id,
      action: 'update',
      summary: `Updated ${field}`,
      before: { [field]: before[field] },
      after: { [field]: outputs ?? value },
    })
  })
  revalidatePath('/training/skills/types')
  revalidatePath(`/training/skills/types/${id}`)
  revalidatePath('/training/skills')
}

export async function deleteSkillType(formData: FormData): Promise<void> {
  const ctx = await requireModuleManage('training')
  const id = requireUuidInput(formData.get('id'), 'Skill type')
  await ctx.db(async (tx) => {
    const [before] = await tx
      .select()
      .from(trainingSkillTypes)
      .where(and(eq(trainingSkillTypes.tenantId, ctx.tenantId), eq(trainingSkillTypes.id, id)))
      .for('update')
      .limit(1)
    if (!before) throw new Error('Skill type not found.')
    if (before.deletedAt) return
    await assertComplianceTargetCanRetire(tx, ctx.tenantId, 'skill_type', id)
    await tx
      .update(trainingSkillTypes)
      .set({ deletedAt: new Date(), isActive: false })
      .where(and(eq(trainingSkillTypes.tenantId, ctx.tenantId), eq(trainingSkillTypes.id, id)))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_skill_type',
      entityId: id,
      action: 'delete',
      summary: 'Deleted skill type; retained ticket history',
      before: { name: before.name },
    })
  })
  revalidatePath('/training/skills/types')
  revalidatePath('/training/skills')
  redirect('/training/skills/types')
}
