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
import { and, eq } from 'drizzle-orm'
import {
  trainingSkillAssignmentFiles,
  trainingSkillAssignments,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { addMonthsIso, isoToday } from '../_lib/dates'

const ALLOWED_FILE_KINDS = new Set(['certificate', 'evidence', 'photo', 'other'])

// ---------------------------------------------------------------------------
// "New skill" — creates the row immediately and redirects straight to its
// unified record page, where every field (incl. person/skill type) is edited
// inline. No intermediate form (mirrors how hazard assessments start). Person +
// skill type default to the first available rows (required FKs).
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
    return row?.id ?? null
  })
  if (!newId) throw new Error('Could not create the skill.')

  await recordAudit(ctx, {
    entityType: 'training_skill',
    entityId: newId,
    action: 'create',
    summary: 'Created skill draft',
  })
  revalidatePath('/training/skills')
  redirect(`/training/skills/${newId}`)
}

// ---------------------------------------------------------------------------
// Per-field auto-save for the shared Live* field set — the unified create/edit/
// view surface (mirrors the class / incident detail pages).
// ---------------------------------------------------------------------------

const SKILL_REQUIRED_IDS = new Set(['personId', 'skillTypeId'])
const SKILL_DATE_NOTNULL = new Set(['grantedOn'])
const SKILL_DATE_NULL = new Set(['expiresOn'])
const SKILL_TEXT_NULL = new Set(['notes'])

export async function updateSkillAssignmentField(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const id = String(formData.get('id') ?? '')
  const field = String(formData.get('field') ?? '')
  const raw = formData.get('value')
  const value = typeof raw === 'string' ? raw : ''
  if (!id || !field) throw new Error('Missing id/field')

  const allowed =
    SKILL_REQUIRED_IDS.has(field) ||
    SKILL_DATE_NOTNULL.has(field) ||
    SKILL_DATE_NULL.has(field) ||
    SKILL_TEXT_NULL.has(field)
  if (!allowed) throw new Error('Field not allowed')

  const before = await ctx.db(async (tx) => {
    const [r] = await tx
      .select({ id: trainingSkillAssignments.id })
      .from(trainingSkillAssignments)
      .where(eq(trainingSkillAssignments.id, id))
      .limit(1)
    return r ?? null
  })
  if (!before) throw new Error('Skill assignment not found')

  let val: unknown
  if (SKILL_REQUIRED_IDS.has(field)) {
    // Draft-friendly: a blank person/skill type is a valid in-progress state, so
    // an empty save is a silent no-op rather than a "required" error.
    if (!value) return
    val = value
  } else if (SKILL_DATE_NOTNULL.has(field)) {
    if (!value) return // draft-friendly: keep the existing date rather than erroring
    if (Number.isNaN(new Date(value).getTime())) throw new Error('A valid date is required')
    val = value
  } else if (SKILL_DATE_NULL.has(field)) {
    if (value.trim() === '') val = null
    else {
      if (Number.isNaN(new Date(value).getTime())) throw new Error('Invalid date')
      val = value
    }
  } else {
    val = value.trim() === '' ? null : value.trim()
  }

  await ctx.db((tx) =>
    tx
      .update(trainingSkillAssignments)
      .set({ [field]: val } as any)
      .where(eq(trainingSkillAssignments.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'training_skill',
    entityId: id,
    action: 'update',
    summary: `Updated ${field}`,
    after: { [field]: val },
  })
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
  const id = String(formData.get('id') ?? '')
  const grantedOn = String(formData.get('grantedOn') ?? '').trim() || isoToday()
  const expiresOnRaw = String(formData.get('expiresOn') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null
  if (!id) return

  const existing = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        assignment: trainingSkillAssignments,
        validForMonths: trainingSkillTypes.validForMonths,
      })
      .from(trainingSkillAssignments)
      .innerJoin(
        trainingSkillTypes,
        eq(trainingSkillTypes.id, trainingSkillAssignments.skillTypeId),
      )
      .where(eq(trainingSkillAssignments.id, id))
      .limit(1)
    return row ?? null
  })
  if (!existing) return

  // Auto-compute expiry from the skill type when not supplied.
  let expiresOn: string | null = expiresOnRaw
  if (!expiresOn && existing.validForMonths) {
    expiresOn = addMonthsIso(grantedOn, existing.validForMonths)
  }

  let newId: string | undefined
  await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(trainingSkillAssignments)
      .values({
        tenantId: ctx.tenantId,
        personId: existing.assignment.personId,
        skillTypeId: existing.assignment.skillTypeId,
        grantedOn,
        expiresOn,
        grantedByTenantUserId: ctx.membership?.id ?? null,
        notes,
      })
      .returning({ id: trainingSkillAssignments.id })
    newId = row?.id
  })
  if (newId) {
    await recordAudit(ctx, {
      entityType: 'training_skill',
      entityId: newId,
      action: 'create',
      summary: 'Skill renewed (created replacement)',
      after: { previousAssignmentId: id, grantedOn, expiresOn },
    })
  }
  revalidatePath(`/training/skills/${id}`)
  revalidatePath('/training/skills')
  if (newId) redirect(`/training/skills/${newId}`)
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
  const id = String(formData.get('id') ?? '')
  const reason = String(formData.get('reason') ?? '').trim() || null
  if (!id) return

  await ctx.db((tx) =>
    tx
      .update(trainingSkillAssignments)
      .set({ deletedAt: new Date() })
      .where(eq(trainingSkillAssignments.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'training_skill',
    entityId: id,
    action: 'delete',
    summary: 'Revoked skill assignment',
    after: { reason },
  })
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
  if (!args.assignmentId) return { ok: false, error: 'Missing assignment' }
  if (!args.attachmentId) return { ok: false, error: 'Missing attachment' }
  const label = args.label.trim()
  if (!label) return { ok: false, error: 'Label is required' }
  const kind = ALLOWED_FILE_KINDS.has(args.kind) ? args.kind : 'other'

  const [row] = await ctx.db((tx) =>
    tx
      .insert(trainingSkillAssignmentFiles)
      .values({
        tenantId: ctx.tenantId,
        skillAssignmentId: args.assignmentId,
        attachmentId: args.attachmentId,
        label,
        kind,
        uploadedBy: ctx.userId,
      })
      .returning(),
  )
  if (!row) return { ok: false, error: 'Insert failed' }

  await recordAudit(ctx, {
    entityType: 'training_skill',
    entityId: args.assignmentId,
    action: 'create',
    summary: `Uploaded file: ${label}`,
    metadata: { fileId: row.id, attachmentId: args.attachmentId, kind },
  })
  revalidatePath(`/training/skills/${args.assignmentId}`)
  return { ok: true }
}

export async function deleteSkillAssignmentFile(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const id = String(formData.get('id') ?? '')
  const assignmentId = String(formData.get('assignmentId') ?? '')
  if (!id || !assignmentId) return

  const before = await ctx.db(async (tx) => {
    const [r] = await tx
      .select()
      .from(trainingSkillAssignmentFiles)
      .where(
        and(
          eq(trainingSkillAssignmentFiles.id, id),
          eq(trainingSkillAssignmentFiles.skillAssignmentId, assignmentId),
        ),
      )
      .limit(1)
    return r ?? null
  })
  if (!before) return

  await ctx.db((tx) =>
    tx.delete(trainingSkillAssignmentFiles).where(eq(trainingSkillAssignmentFiles.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'training_skill',
    entityId: assignmentId,
    action: 'delete',
    summary: `Deleted file: ${before.label}`,
    before: before as unknown as Record<string, unknown>,
  })
  revalidatePath(`/training/skills/${assignmentId}`)
}
