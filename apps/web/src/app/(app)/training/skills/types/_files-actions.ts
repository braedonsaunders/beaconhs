'use server'

import { and, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { attachments, trainingSkillTypes, trainingSkillTypeFiles } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { recordAuditInTransaction } from '@/lib/audit'
import { requireUuidInput, requiredTextInput, requireEnumInput } from '@/lib/mutation-input'

export async function addSkillTypeFile(input: {
  recordId: string
  attachmentId: string
  label: string
  kind: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireModuleManage('training')
  try {
    const skillTypeId = requireUuidInput(input.recordId, 'Skill type')
    const attachmentId = requireUuidInput(input.attachmentId, 'Attachment')
    const label = requiredTextInput(input.label, 'Label', 300)
    const kind = requireEnumInput(
      input.kind,
      ['certificate', 'evidence', 'photo', 'other'] as const,
      'File kind',
    )
    await ctx.db(async (tx) => {
      const [type] = await tx
        .select({ id: trainingSkillTypes.id })
        .from(trainingSkillTypes)
        .where(and(eq(trainingSkillTypes.id, skillTypeId), isNull(trainingSkillTypes.deletedAt)))
        .for('update')
        .limit(1)
      if (!type) throw new Error('Skill type not found.')
      const [attachment] = await tx
        .select({ id: attachments.id })
        .from(attachments)
        .where(and(eq(attachments.id, attachmentId), eq(attachments.uploadedBy, ctx.userId)))
        .limit(1)
      if (!attachment) throw new Error('Upload a file before attaching it.')
      const [file] = await tx
        .insert(trainingSkillTypeFiles)
        .values({
          tenantId: ctx.tenantId,
          skillTypeId,
          attachmentId,
          label,
          kind,
          uploadedBy: ctx.userId,
        })
        .onConflictDoNothing()
        .returning({ id: trainingSkillTypeFiles.id })
      if (!file) throw new Error('This file is already attached.')
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'training_skill_type',
        entityId: skillTypeId,
        action: 'create',
        summary: `Attached file: ${label}`,
        metadata: { fileId: file.id, attachmentId, kind },
      })
    })
    revalidatePath(`/training/skills/types/${skillTypeId}`)
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'File could not be attached.',
    }
  }
}

export async function removeSkillTypeFile(formData: FormData) {
  const ctx = await requireModuleManage('training')
  const skillTypeId = requireUuidInput(formData.get('skillTypeId'), 'Skill type')
  const id = requireUuidInput(formData.get('fileId'), 'File')
  await ctx.db(async (tx) => {
    const [file] = await tx
      .delete(trainingSkillTypeFiles)
      .where(
        and(eq(trainingSkillTypeFiles.id, id), eq(trainingSkillTypeFiles.skillTypeId, skillTypeId)),
      )
      .returning()
    if (!file) throw new Error('File not found.')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_skill_type',
      entityId: skillTypeId,
      action: 'delete',
      summary: `Removed file: ${file.label}`,
      before: file,
    })
  })
  revalidatePath(`/training/skills/types/${skillTypeId}`)
}
