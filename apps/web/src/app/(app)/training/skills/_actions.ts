'use server'

import { activePeopleWhere } from '@beaconhs/db'

// Server actions for the per-person skill-assignment detail page
// (/training/skills/[id]). Skill assignments were previously only created by
// the seed/migration path — this is the first UI that edits, renews, deletes,
// and attaches files to them.
//
// Mutations are gated with `assertCanManageModule(ctx, 'training')`; the page
// itself is viewable by any training user (like /training/records).

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import {
  attachments,
  auditLog,
  people,
  trainingSkillAssignmentFiles,
  trainingSkillAssignments,
  trainingSkillCertificates,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAuditInTransaction } from '@/lib/audit'
import { dateIsoInTimeZone } from '@/lib/datetime'
import { addMonthsIso } from '../_lib/dates'
import { requireUuidInput } from '@/lib/mutation-input'
import { MAX_TRAINING_VALIDITY_MONTHS } from '@/lib/training-mutation-validation'
import { materializeSkillEvidence } from './_skill-evidence'
import { parseRevocationReason, parseSkillFileInput } from './_mutation-input'

function skillExpiry(grantedOn: string, validForMonths: number | null): string | null {
  if (validForMonths == null || validForMonths === 0) return null
  if (
    !Number.isSafeInteger(validForMonths) ||
    validForMonths < 0 ||
    validForMonths > MAX_TRAINING_VALIDITY_MONTHS
  ) {
    throw new Error('Skill validity is invalid; correct the skill type before renewing it.')
  }
  return addMonthsIso(grantedOn, validForMonths)
}

// ---------------------------------------------------------------------------
// "New skill" — creates the row immediately and redirects straight to its
// unified record page, where every field (incl. person/skill type) is edited
// inline. No intermediate form (mirrors how hazard assessments start).
// ---------------------------------------------------------------------------

export async function startSkillAssignment(): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')

  const newId = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(trainingSkillAssignments)
      .values({
        tenantId: ctx.tenantId,
        grantedOn: dateIsoInTimeZone(new Date(), ctx.timezone),
        grantedByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning({ id: trainingSkillAssignments.id })
    if (!row) throw new Error('Could not create the skill.')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_skill',
      entityId: row.id,
      action: 'create',
      summary: 'Created skill draft',
    })
    return row.id
  })
  revalidatePath('/training/skills')
  revalidatePath('/people/[id]', 'page')
  revalidatePath('/training/skills/types/[id]', 'page')
  redirect(`/training/skills/${newId}`)
}

// ---------------------------------------------------------------------------
// Renew — mint a NEW assignment for the same person + skill type with a fresh
// expiry. Mirrors the training-record renewal flow.
// ---------------------------------------------------------------------------

export async function renewSkillAssignment(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const id = requireUuidInput(formData.get('id'), 'Skill assignment')
  const dedupKey = `training-skill-renew:${id}`
  const newId = await ctx.db(async (tx) => {
    const [assignment] = await tx
      .select()
      .from(trainingSkillAssignments)
      .where(eq(trainingSkillAssignments.id, id))
      .for('update')
      .limit(1)
    if (!assignment) throw new Error('Skill assignment not found.')
    if (!assignment.personId || !assignment.skillTypeId) {
      throw new Error('Choose a person and skill type before renewing this assignment.')
    }

    // A source assignment has one direct replacement. This audit-backed marker
    // makes retries and double-clicks idempotent; further renewals start from the
    // replacement record rather than minting siblings from the same history row.
    const [previousRenewal] = await tx
      .select({ entityId: auditLog.entityId })
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, ctx.tenantId), eq(auditLog.dedupKey, dedupKey)))
      .limit(1)
    if (previousRenewal) {
      if (!previousRenewal.entityId) {
        throw new Error('The recorded renewal is incomplete. Contact a platform administrator.')
      }
      const [replacement] = await tx
        .select({ id: trainingSkillAssignments.id })
        .from(trainingSkillAssignments)
        .where(eq(trainingSkillAssignments.id, previousRenewal.entityId))
        .limit(1)
      if (!replacement) {
        throw new Error('The recorded renewal is missing. Contact a platform administrator.')
      }
      return replacement.id
    }

    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, assignment.personId), activePeopleWhere()))
      .limit(1)
    if (!person) throw new Error('Only an active person can receive a renewed skill.')
    const [skillType] = await tx
      .select({ validForMonths: trainingSkillTypes.validForMonths })
      .from(trainingSkillTypes)
      .where(
        and(
          eq(trainingSkillTypes.id, assignment.skillTypeId),
          eq(trainingSkillTypes.isActive, true),
          isNull(trainingSkillTypes.deletedAt),
        ),
      )
      .limit(1)
    if (!skillType) throw new Error('The skill type is no longer available.')

    const grantedOn = dateIsoInTimeZone(new Date(), ctx.timezone)
    const expiresOn = skillExpiry(grantedOn, skillType.validForMonths)
    const [row] = await tx
      .insert(trainingSkillAssignments)
      .values({
        tenantId: ctx.tenantId,
        personId: assignment.personId,
        skillTypeId: assignment.skillTypeId,
        status: 'complete',
        grantedOn,
        expiresOn,
        grantedByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning({ id: trainingSkillAssignments.id })
    if (!row) throw new Error('Could not create the renewed skill assignment.')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_skill',
      entityId: row.id,
      action: 'create',
      summary: 'Skill renewed (created replacement)',
      after: { previousAssignmentId: id, grantedOn, expiresOn },
      dedupKey,
    })
    await materializeSkillEvidence(tx, ctx.tenantId, [assignment.skillTypeId])
    return row.id
  })
  revalidatePath(`/training/skills/${id}`)
  revalidatePath('/training/skills')
  revalidatePath('/people/[id]', 'page')
  revalidatePath('/training/skills/types/[id]', 'page')
  redirect(`/training/skills/${newId}`)
}

// ---------------------------------------------------------------------------
// Revoke — soft-delete (set deletedAt). Same audit-safe lifecycle as a revoked
// training_records certificate: the row leaves the lists/matrix/compliance but
// is retained for the audit trail. Stays on the record page showing a revoked
// banner.
// ---------------------------------------------------------------------------

export async function revokeSkillAssignment(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const id = requireUuidInput(formData.get('id'), 'Skill assignment')
  const reason = parseRevocationReason(formData.get('reason'))

  const changed = await ctx.db(async (tx) => {
    const [assignment] = await tx
      .select({
        id: trainingSkillAssignments.id,
        skillTypeId: trainingSkillAssignments.skillTypeId,
        deletedAt: trainingSkillAssignments.deletedAt,
      })
      .from(trainingSkillAssignments)
      .where(eq(trainingSkillAssignments.id, id))
      .for('update')
      .limit(1)
    if (!assignment) throw new Error('Skill assignment not found.')
    if (assignment.deletedAt) return false

    const revokedAt = new Date()
    const [revoked] = await tx
      .update(trainingSkillAssignments)
      .set({ deletedAt: revokedAt })
      .where(and(eq(trainingSkillAssignments.id, id), isNull(trainingSkillAssignments.deletedAt)))
      .returning({ id: trainingSkillAssignments.id })
    if (!revoked) throw new Error('Skill assignment could not be revoked.')
    await tx
      .update(trainingSkillCertificates)
      .set({ revokedAt, revokedReason: reason })
      .where(
        and(
          eq(trainingSkillCertificates.skillAssignmentId, id),
          isNull(trainingSkillCertificates.revokedAt),
        ),
      )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_skill',
      entityId: id,
      action: 'delete',
      summary: 'Revoked skill assignment',
      before: { deletedAt: null },
      after: { deletedAt: revokedAt },
      metadata: { reason },
    })
    await materializeSkillEvidence(tx, ctx.tenantId, [assignment.skillTypeId])
    return true
  })
  if (!changed) return
  revalidatePath(`/training/skills/${id}`)
  revalidatePath('/training/skills')
  revalidatePath('/people/[id]', 'page')
  revalidatePath('/training/skills/types/[id]', 'page')
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export async function addSkillAssignmentFile(args: {
  assignmentId: string
  attachmentId: string
  label: string
  kind: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  let input: ReturnType<typeof parseSkillFileInput>
  try {
    input = parseSkillFileInput(args)
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'File details are invalid.',
    }
  }

  const result = await ctx.db(async (tx) => {
    const [assignment] = await tx
      .select({ id: trainingSkillAssignments.id })
      .from(trainingSkillAssignments)
      .where(eq(trainingSkillAssignments.id, input.assignmentId))
      .for('update')
      .limit(1)
    if (!assignment) return { ok: false as const, error: 'Skill assignment not found.' }
    const [attachment] = await tx
      .select({ id: attachments.id })
      .from(attachments)
      .where(eq(attachments.id, input.attachmentId))
      .limit(1)
    if (!attachment) return { ok: false as const, error: 'Uploaded attachment not found.' }
    const [existing] = await tx
      .select({ id: trainingSkillAssignmentFiles.id })
      .from(trainingSkillAssignmentFiles)
      .where(
        and(
          eq(trainingSkillAssignmentFiles.skillAssignmentId, input.assignmentId),
          eq(trainingSkillAssignmentFiles.attachmentId, input.attachmentId),
        ),
      )
      .limit(1)
    if (existing) {
      return { ok: false as const, error: 'This file is already attached to the skill.' }
    }

    const [row] = await tx
      .insert(trainingSkillAssignmentFiles)
      .values({
        tenantId: ctx.tenantId,
        skillAssignmentId: input.assignmentId,
        attachmentId: input.attachmentId,
        label: input.label,
        kind: input.kind,
        uploadedBy: ctx.userId,
      })
      .returning()
    if (!row) return { ok: false as const, error: 'File could not be attached.' }
    if (input.kind === 'certificate')
      await tx
        .update(trainingSkillAssignments)
        .set({ evidenceAttachmentId: input.attachmentId })
        .where(
          and(
            eq(trainingSkillAssignments.id, input.assignmentId),
            isNull(trainingSkillAssignments.evidenceAttachmentId),
          ),
        )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_skill',
      entityId: input.assignmentId,
      action: 'create',
      summary: `Uploaded file: ${input.label}`,
      metadata: { fileId: row.id, attachmentId: input.attachmentId, kind: input.kind },
    })
    return { ok: true as const }
  })
  if (result.ok) revalidatePath(`/training/skills/${input.assignmentId}`)
  return result
}

export async function deleteSkillAssignmentFile(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const id = requireUuidInput(formData.get('id'), 'Skill file')
  const assignmentId = requireUuidInput(formData.get('assignmentId'), 'Skill assignment')

  await ctx.db(async (tx) => {
    const [assignment] = await tx
      .select({ id: trainingSkillAssignments.id })
      .from(trainingSkillAssignments)
      .where(eq(trainingSkillAssignments.id, assignmentId))
      .for('update')
      .limit(1)
    if (!assignment) throw new Error('Skill assignment not found.')
    const [before] = await tx
      .select()
      .from(trainingSkillAssignmentFiles)
      .where(
        and(
          eq(trainingSkillAssignmentFiles.id, id),
          eq(trainingSkillAssignmentFiles.skillAssignmentId, assignmentId),
        ),
      )
      .for('update')
      .limit(1)
    if (!before) throw new Error('Skill file not found.')
    const [deleted] = await tx
      .delete(trainingSkillAssignmentFiles)
      .where(
        and(
          eq(trainingSkillAssignmentFiles.id, id),
          eq(trainingSkillAssignmentFiles.skillAssignmentId, assignmentId),
        ),
      )
      .returning({ id: trainingSkillAssignmentFiles.id })
    if (!deleted) throw new Error('Skill file could not be deleted.')
    if (before.attachmentId)
      await tx
        .update(trainingSkillAssignments)
        .set({ evidenceAttachmentId: null })
        .where(
          and(
            eq(trainingSkillAssignments.id, assignmentId),
            eq(trainingSkillAssignments.evidenceAttachmentId, before.attachmentId),
          ),
        )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_skill',
      entityId: assignmentId,
      action: 'delete',
      summary: `Deleted file: ${before.label}`,
      before: {
        id: before.id,
        attachmentId: before.attachmentId,
        label: before.label,
        kind: before.kind,
      },
    })
  })
  revalidatePath(`/training/skills/${assignmentId}`)
}

export async function setSkillPrimaryFile(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const id = requireUuidInput(formData.get('assignmentId'), 'Skill assignment')
  const fileId = requireUuidInput(formData.get('id'), 'File')
  await ctx.db(async (tx) => {
    const [assignment] = await tx
      .select()
      .from(trainingSkillAssignments)
      .where(and(eq(trainingSkillAssignments.id, id), isNull(trainingSkillAssignments.deletedAt)))
      .for('update')
      .limit(1)
    const [file] = await tx
      .select()
      .from(trainingSkillAssignmentFiles)
      .where(
        and(
          eq(trainingSkillAssignmentFiles.id, fileId),
          eq(trainingSkillAssignmentFiles.skillAssignmentId, id),
        ),
      )
      .limit(1)
    if (!assignment || !file?.attachmentId) throw new Error('Skill credential file not found.')
    await tx
      .update(trainingSkillAssignments)
      .set({ evidenceAttachmentId: file.attachmentId })
      .where(eq(trainingSkillAssignments.id, id))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_skill',
      entityId: id,
      action: 'update',
      summary: 'Selected uploaded credential',
      before: { attachmentId: assignment.evidenceAttachmentId },
      after: { attachmentId: file.attachmentId },
    })
  })
  revalidatePath(`/training/skills/${id}`)
}
