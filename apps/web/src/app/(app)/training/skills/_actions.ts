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
import { assertCanManageModule, canManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'

const ALLOWED_FILE_KINDS = new Set(['certificate', 'evidence', 'photo', 'other'])

function safeTenantUserId(ctx: Awaited<ReturnType<typeof requireRequestContext>>): string | null {
  const id = ctx.membership?.id
  if (!id || id === 'super-admin') return null
  return id
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function addMonthsIso(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const day = d.getUTCDate()
  d.setUTCMonth(d.getUTCMonth() + months)
  // Clamp month-end roll-over (e.g. Jan 31 + 1mo → Feb 28, not Mar 3).
  if (d.getUTCDate() < day) d.setUTCDate(0)
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Inline edit (unified display + edit surface autosaves through this)
// ---------------------------------------------------------------------------

export async function saveSkillAssignment(input: {
  assignmentId: string
  grantedOn: string
  expiresOn: string | null
  notes: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  if (!canManageModule(ctx, 'training')) {
    return { ok: false, error: 'You do not have permission to edit skills.' }
  }
  const { assignmentId } = input
  const grantedOn = input.grantedOn.trim()
  const expiresOn = input.expiresOn?.trim() || null
  const notes = input.notes?.trim() || null
  if (!assignmentId) return { ok: false, error: 'Missing assignment' }
  if (!grantedOn) return { ok: false, error: 'Granted date is required' }

  const before = await ctx.db(async (tx) => {
    const [r] = await tx
      .select()
      .from(trainingSkillAssignments)
      .where(eq(trainingSkillAssignments.id, assignmentId))
      .limit(1)
    return r ?? null
  })
  if (!before) return { ok: false, error: 'Skill assignment not found' }

  // No-op guard: don't write an audit row when nothing actually changed.
  if (before.grantedOn === grantedOn && before.expiresOn === expiresOn && before.notes === notes) {
    return { ok: true }
  }

  await ctx.db((tx) =>
    tx
      .update(trainingSkillAssignments)
      .set({ grantedOn, expiresOn, notes })
      .where(eq(trainingSkillAssignments.id, assignmentId)),
  )
  await recordAudit(ctx, {
    entityType: 'training_skill',
    entityId: assignmentId,
    action: 'update',
    summary: 'Updated skill assignment',
    before: { grantedOn: before.grantedOn, expiresOn: before.expiresOn, notes: before.notes },
    after: { grantedOn, expiresOn, notes },
  })
  revalidatePath(`/training/skills/${assignmentId}`)
  revalidatePath('/training/skills')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Create — issue a skill assignment from the New skill form. Person + skill type
// are required; expiry auto-computes from the type's validForMonths when not
// supplied. Redirects to the new record so the rest can be edited inline.
// ---------------------------------------------------------------------------

export async function createSkillAssignment(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const personId = String(formData.get('personId') ?? '').trim()
  const skillTypeId = String(formData.get('skillTypeId') ?? '').trim()
  const grantedOn = String(formData.get('grantedOn') ?? '').trim() || isoToday()
  const expiresOnRaw = String(formData.get('expiresOn') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null
  if (!personId || !skillTypeId) return

  const type = await ctx.db(async (tx) => {
    const [t] = await tx
      .select({ id: trainingSkillTypes.id, validForMonths: trainingSkillTypes.validForMonths })
      .from(trainingSkillTypes)
      .where(eq(trainingSkillTypes.id, skillTypeId))
      .limit(1)
    return t ?? null
  })
  if (!type) return
  let expiresOn: string | null = expiresOnRaw
  if (!expiresOn && type.validForMonths) expiresOn = addMonthsIso(grantedOn, type.validForMonths)

  let newId: string | undefined
  await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(trainingSkillAssignments)
      .values({
        tenantId: ctx.tenantId,
        personId,
        skillTypeId,
        grantedOn,
        expiresOn,
        grantedByTenantUserId: safeTenantUserId(ctx),
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
      summary: 'Created skill assignment',
      after: { personId, skillTypeId, grantedOn, expiresOn },
    })
  }
  revalidatePath('/training/skills')
  if (newId) redirect(`/training/skills/${newId}`)
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
        grantedByTenantUserId: safeTenantUserId(ctx),
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
// Delete — hard delete. Cascades to the credential row + uploaded files via FK.
// (Skill assignments have no soft-delete column; a wrongly-entered assignment
// should be removable outright.)
// ---------------------------------------------------------------------------

export async function deleteSkillAssignment(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const id = String(formData.get('id') ?? '')
  if (!id) return

  const before = await ctx.db(async (tx) => {
    const [r] = await tx
      .select()
      .from(trainingSkillAssignments)
      .where(eq(trainingSkillAssignments.id, id))
      .limit(1)
    return r ?? null
  })
  if (!before) return

  await ctx.db((tx) =>
    tx.delete(trainingSkillAssignments).where(eq(trainingSkillAssignments.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'training_skill',
    entityId: id,
    action: 'delete',
    summary: 'Deleted skill assignment',
    before: before as unknown as Record<string, unknown>,
  })
  revalidatePath('/training/skills')
  redirect('/training/skills')
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
