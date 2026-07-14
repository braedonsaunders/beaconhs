'use server'

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
import type { Database } from '@beaconhs/db'
import {
  attachments,
  auditLog,
  people,
  trainingSkillAssignmentFiles,
  trainingSkillAssignments,
  trainingSkillCertificates,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import { materializeEvidenceTargetsObligations } from '@beaconhs/compliance'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAuditInTransaction } from '@/lib/audit'
import { addMonthsIso, isoToday } from '../_lib/dates'
import { requireUuidInput } from '@/lib/mutation-input'
import { MAX_TRAINING_VALIDITY_MONTHS } from '@/lib/training-mutation-validation'
import {
  assertSkillAssignmentDateOrder,
  parseRevocationReason,
  parseSkillAssignmentFieldUpdate,
  parseSkillFileInput,
  type SkillAssignmentFieldUpdate,
} from './_mutation-input'

type SkillAssignment = typeof trainingSkillAssignments.$inferSelect

async function materializeSkillEvidence(
  tx: Database,
  tenantId: string,
  skillTypeIds: readonly (string | null)[],
): Promise<void> {
  await materializeEvidenceTargetsObligations(
    tx,
    tenantId,
    [...new Set(skillTypeIds.filter((id): id is string => Boolean(id)))].map((skillTypeId) => ({
      sourceModule: 'cert_requirement' as const,
      targetRef: { skillTypeId },
    })),
  )
}

function skillAssignmentFieldValue(
  assignment: SkillAssignment,
  field: SkillAssignmentFieldUpdate['field'],
): string | null {
  switch (field) {
    case 'personId':
      return assignment.personId
    case 'skillTypeId':
      return assignment.skillTypeId
    case 'grantedOn':
      return assignment.grantedOn
    case 'expiresOn':
      return assignment.expiresOn
    case 'notes':
      return assignment.notes
  }
}

async function updateSkillAssignmentColumn(
  tx: Database,
  id: string,
  update: SkillAssignmentFieldUpdate,
): Promise<{ id: string }[]> {
  const where = and(eq(trainingSkillAssignments.id, id), isNull(trainingSkillAssignments.deletedAt))
  switch (update.field) {
    case 'personId':
      return tx
        .update(trainingSkillAssignments)
        .set({ personId: update.value })
        .where(where)
        .returning({ id: trainingSkillAssignments.id })
    case 'skillTypeId':
      return tx
        .update(trainingSkillAssignments)
        .set({ skillTypeId: update.value })
        .where(where)
        .returning({ id: trainingSkillAssignments.id })
    case 'grantedOn':
      return tx
        .update(trainingSkillAssignments)
        .set({ grantedOn: update.value })
        .where(where)
        .returning({ id: trainingSkillAssignments.id })
    case 'expiresOn':
      return tx
        .update(trainingSkillAssignments)
        .set({ expiresOn: update.value })
        .where(where)
        .returning({ id: trainingSkillAssignments.id })
    case 'notes':
      return tx
        .update(trainingSkillAssignments)
        .set({ notes: update.value })
        .where(where)
        .returning({ id: trainingSkillAssignments.id })
  }
}

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
        grantedOn: isoToday(),
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
  redirect(`/training/skills/${newId}`)
}

// ---------------------------------------------------------------------------
// Per-field auto-save for the shared Live* field set — the unified create/edit/
// view surface (mirrors the class / incident detail pages).
// ---------------------------------------------------------------------------

export async function updateSkillAssignmentField(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const id = requireUuidInput(formData.get('id'), 'Skill assignment')
  const update = parseSkillAssignmentFieldUpdate(formData.get('field'), formData.get('value'))

  const changed = await ctx.db(async (tx) => {
    const [assignment] = await tx
      .select()
      .from(trainingSkillAssignments)
      .where(eq(trainingSkillAssignments.id, id))
      .for('update')
      .limit(1)
    if (!assignment) throw new Error('Skill assignment not found.')
    if (assignment.deletedAt) throw new Error('Revoked skill assignments cannot be edited.')

    if (update.field === 'personId' && update.value !== assignment.personId) {
      const [person] = await tx
        .select({ id: people.id })
        .from(people)
        .where(
          and(eq(people.id, update.value), eq(people.status, 'active'), isNull(people.deletedAt)),
        )
        .limit(1)
      if (!person) throw new Error('The selected person is not active in this workspace.')
    }
    if (update.field === 'skillTypeId' && update.value !== assignment.skillTypeId) {
      const [skillType] = await tx
        .select({ id: trainingSkillTypes.id })
        .from(trainingSkillTypes)
        .where(eq(trainingSkillTypes.id, update.value))
        .limit(1)
      if (!skillType) throw new Error('The selected skill type is not available in this workspace.')
    }

    if (update.field === 'grantedOn') {
      assertSkillAssignmentDateOrder(update.value, assignment.expiresOn)
    } else if (update.field === 'expiresOn') {
      assertSkillAssignmentDateOrder(assignment.grantedOn, update.value)
    }

    const previous = skillAssignmentFieldValue(assignment, update.field)
    if (previous === update.value) return false
    const [updated] = await updateSkillAssignmentColumn(tx, id, update)
    if (!updated) throw new Error('Skill assignment could not be updated.')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_skill',
      entityId: id,
      action: 'update',
      summary: `Updated ${update.field}`,
      before: { [update.field]: previous },
      after: { [update.field]: update.value },
    })
    if (
      update.field === 'personId' ||
      update.field === 'skillTypeId' ||
      update.field === 'grantedOn' ||
      update.field === 'expiresOn'
    ) {
      await materializeSkillEvidence(tx, ctx.tenantId, [
        assignment.skillTypeId,
        update.field === 'skillTypeId' ? update.value : assignment.skillTypeId,
      ])
    }
    return true
  })
  if (!changed) return
  revalidatePath(`/training/skills/${id}`)
  revalidatePath('/training/skills')
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
      .where(
        and(
          eq(people.id, assignment.personId),
          eq(people.status, 'active'),
          isNull(people.deletedAt),
        ),
      )
      .limit(1)
    if (!person) throw new Error('Only an active person can receive a renewed skill.')
    const [skillType] = await tx
      .select({ validForMonths: trainingSkillTypes.validForMonths })
      .from(trainingSkillTypes)
      .where(eq(trainingSkillTypes.id, assignment.skillTypeId))
      .limit(1)
    if (!skillType) throw new Error('The skill type is no longer available.')

    const grantedOn = isoToday()
    const expiresOn = skillExpiry(grantedOn, skillType.validForMonths)
    const [row] = await tx
      .insert(trainingSkillAssignments)
      .values({
        tenantId: ctx.tenantId,
        personId: assignment.personId,
        skillTypeId: assignment.skillTypeId,
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
