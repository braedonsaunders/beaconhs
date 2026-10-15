'use server'

import { assertComplianceTargetCanRetire } from '@beaconhs/compliance'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { trainingSkillAuthorities, trainingSkillTypes } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { recordAuditInTransaction } from '@/lib/audit'
import { optionalTextInput, requiredTextInput, requireUuidInput } from '@/lib/mutation-input'
import {
  optionalTrainingInteger,
  MAX_TRAINING_VALIDITY_MONTHS,
} from '@/lib/training-mutation-validation'

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
