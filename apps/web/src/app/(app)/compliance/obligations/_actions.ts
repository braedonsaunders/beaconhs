'use server'

// Unified obligation CRUD — writes the ONE `compliance_obligations` table for
// EVERY kind (the 5 audience assignments + cert requirements + equipment/PPE
// policies + job-title sign-offs). No more per-module delegation: this is the
// single engine. Completion is computed by the adapters in @beaconhs/compliance
// and materialised into compliance_status on create + by the daily worker scan.

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import {
  type ComplianceRecurrence,
  type ComplianceTargetRef,
  complianceAudience,
  complianceObligations,
  complianceStatus,
} from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { materializeObligation } from '@beaconhs/compliance'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import type { AudienceItem } from '@/components/audience-picker'
import { type RecurrenceValue, frequencyToCron } from '@/components/recurrence'
import { KIND_META, type ObligationKind, kindLabel, recurrenceKindFor } from './_meta'

export type ObligationInput = {
  kind: ObligationKind
  title: string
  notes?: string | null
  audience: AudienceItem[]
  recurrence: RecurrenceValue
  // Targets — only the field relevant to `kind` is read.
  inspectionTypeId?: string
  documentId?: string
  trainingItemKind?: 'course' | 'assessment_type'
  courseId?: string
  assessmentTypeId?: string
  certItemKind?: 'course' | 'skill'
  skillTypeId?: string
  formTemplateId?: string
  equipmentTypeId?: string
  ppeTypeId?: string
  jobTitleId?: string
}

export type ObligationResult =
  | { ok: true; id: string; kind: ObligationKind }
  | { ok: false; error: string }

function buildTargetRef(input: ObligationInput): { ref: ComplianceTargetRef; error?: string } {
  switch (input.kind) {
    case 'inspection':
      if (!input.inspectionTypeId) return { ref: {}, error: 'Pick an inspection type' }
      return { ref: { inspectionTypeId: input.inspectionTypeId } }
    case 'document':
      if (!input.documentId) return { ref: {}, error: 'Pick a document' }
      return { ref: { documentId: input.documentId } }
    case 'training': {
      const k = input.trainingItemKind ?? 'course'
      if (k === 'course' && !input.courseId) return { ref: {}, error: 'Pick a course' }
      if (k === 'assessment_type' && !input.assessmentTypeId)
        return { ref: {}, error: 'Pick an assessment type' }
      return {
        ref: {
          trainingItemKind: k,
          courseId: input.courseId,
          assessmentTypeId: input.assessmentTypeId,
        },
      }
    }
    case 'cert_requirement': {
      // Satisfied either by a valid training record for a course, or by a valid
      // skill grant of a skill type (the ETL fold-in authors the latter too).
      if ((input.certItemKind ?? 'course') === 'skill') {
        if (!input.skillTypeId) return { ref: {}, error: 'Pick the skill type' }
        return { ref: { skillTypeId: input.skillTypeId } }
      }
      if (!input.courseId) return { ref: {}, error: 'Pick the certification (course)' }
      return { ref: { trainingItemKind: 'course', courseId: input.courseId } }
    }
    case 'form':
      if (!input.formTemplateId) return { ref: {}, error: 'Pick an app / form template' }
      return { ref: { formTemplateId: input.formTemplateId } }
    case 'journal':
      return { ref: {} }
    case 'hazard_assessment':
      return { ref: {} }
    case 'equipment_inspection':
      if (!input.equipmentTypeId) return { ref: {}, error: 'Pick an equipment type' }
      return { ref: { equipmentTypeId: input.equipmentTypeId } }
    case 'ppe_inspection':
      if (!input.ppeTypeId) return { ref: {}, error: 'Pick a PPE type' }
      return { ref: { ppeTypeId: input.ppeTypeId } }
    case 'job_title_signoff':
      if (!input.jobTitleId) return { ref: {}, error: 'Pick a job title' }
      return { ref: { jobTitleId: input.jobTitleId } }
  }
}

function buildRecurrence(kind: ObligationKind, r: RecurrenceValue): ComplianceRecurrence {
  const cronFor = () => r.cron?.trim() || frequencyToCron(r.frequency ?? 'week')
  if (kind === 'cert_requirement' || kind === 'equipment_inspection' || kind === 'ppe_inspection')
    return { kind: 'expiry', remindBeforeDays: 30 }
  if (kind === 'job_title_signoff') return { kind: 'one_time' }
  if (kind === 'form')
    return { kind: 'cron', cron: cronFor(), dueOffsetMinutes: r.dueOffsetMinutes }
  if (kind === 'document') return { kind: 'one_time', dueOn: r.dueOn }
  if (kind === 'training')
    return r.kind === 'one_time'
      ? { kind: 'one_time', dueOn: r.dueOn, remindBeforeDays: r.remindBeforeDays ?? 7 }
      : {
          kind: 'frequency',
          frequency: r.frequency ?? 'week',
          cron: cronFor(),
          remindBeforeDays: r.remindBeforeDays ?? 7,
        }
  // inspection / journal → frequency
  return {
    kind: 'frequency',
    frequency: r.frequency ?? 'week',
    quantity: Math.max(1, r.quantity ?? 1),
    compliantPercentage: Math.max(0, Math.min(100, r.compliantPercentage ?? 100)),
    dueOffsetMinutes: r.dueOffsetMinutes,
  }
}

// Audience rows (per_person only). Journal with no picks ⇒ everyone.
function buildAudienceRows(input: ObligationInput): {
  rows: { kind: string; entityKey: string }[]
  error?: string
} {
  if (!KIND_META[input.kind].audience) return { rows: [] }
  const rows = input.audience.map((a) => ({
    kind: a.type,
    entityKey: a.type === 'everyone' ? '' : a.entityKey,
  }))
  if (rows.length === 0) {
    if (input.kind === 'journal' || input.kind === 'hazard_assessment')
      return { rows: [{ kind: 'everyone', entityKey: '' }] }
    return { rows, error: 'Add at least one audience target' }
  }
  return { rows }
}

// Refresh the materialised scoreboard for one obligation so the hub rollups
// reflect the change immediately. Best-effort — the daily compliance_scan
// reconciles anything missed.
async function rematerialize(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  id: string,
): Promise<void> {
  try {
    await ctx.db(async (tx) => {
      const [row] = await tx
        .select()
        .from(complianceObligations)
        .where(eq(complianceObligations.id, id))
        .limit(1)
      if (row) await materializeObligation(tx, ctx.tenantId, row)
    })
  } catch {
    /* best-effort — the daily compliance_scan will reconcile */
  }
}

export async function createObligation(input: ObligationInput): Promise<ObligationResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'compliance.assign')
  const meta = KIND_META[input.kind]

  if (input.kind === 'journal' && !input.title.trim())
    return { ok: false, error: 'Name is required' }
  const { ref, error } = buildTargetRef(input)
  if (error) return { ok: false, error }

  const { rows: audienceRows, error: audienceError } = buildAudienceRows(input)
  if (audienceError) return { ok: false, error: audienceError }

  const recurrence = buildRecurrence(input.kind, input.recurrence)
  const recurrenceKind = recurrenceKindFor(input.kind, input.recurrence.kind === 'one_time')

  try {
    const id = await ctx.db(async (tx) => {
      const [row] = await tx
        .insert(complianceObligations)
        .values({
          tenantId: ctx.tenantId,
          sourceModule: input.kind as never,
          subjectKind: meta.subjectKind as never,
          title: input.title.trim() || meta.label,
          notes: input.notes ?? null,
          status: 'active',
          targetRef: ref,
          recurrence,
          recurrenceKind: recurrenceKind as never,
          createdByTenantUserId: ctx.membership?.id ?? null,
        })
        .returning({ id: complianceObligations.id })
      if (audienceRows.length > 0) {
        await tx.insert(complianceAudience).values(
          audienceRows.map((a) => ({
            tenantId: ctx.tenantId,
            obligationId: row!.id,
            kind: a.kind as never,
            entityKey: a.entityKey,
          })),
        )
      }
      return row!.id
    })
    await recordAudit(ctx, {
      entityType: 'compliance_obligation',
      entityId: id,
      action: 'create',
      summary: `Created ${kindLabel(input.kind)} obligation "${input.title.trim() || meta.label}"`,
    })
    await rematerialize(ctx, id)
    revalidatePath('/compliance/obligations')
    return { ok: true, id, kind: input.kind }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to create obligation' }
  }
}

export async function updateObligation(
  id: string,
  input: ObligationInput,
): Promise<ObligationResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'compliance.manage')
  const meta = KIND_META[input.kind]

  const [existing] = await ctx.db((tx) =>
    tx.select().from(complianceObligations).where(eq(complianceObligations.id, id)).limit(1),
  )
  if (!existing || existing.deletedAt) return { ok: false, error: 'Obligation not found' }
  // The kind determines the subject shape, target and evaluation adapter — it
  // is fixed at creation. Delete + recreate to change it.
  if (existing.sourceModule !== input.kind)
    return { ok: false, error: 'The kind of an obligation cannot be changed' }

  if (input.kind === 'journal' && !input.title.trim())
    return { ok: false, error: 'Name is required' }
  const { ref, error } = buildTargetRef(input)
  if (error) return { ok: false, error }

  const { rows: audienceRows, error: audienceError } = buildAudienceRows(input)
  if (audienceError) return { ok: false, error: audienceError }

  // Kinds with no schedule knobs in the form (cert / equipment / PPE /
  // job-title) keep their stored recurrence untouched — rebuilding would
  // clobber values authored elsewhere (e.g. the ETL fold-in).
  const hasScheduleKnobs = Object.values(meta.recurrence).some(Boolean)
  const recurrence = hasScheduleKnobs
    ? buildRecurrence(input.kind, input.recurrence)
    : existing.recurrence
  const recurrenceKind = hasScheduleKnobs
    ? recurrenceKindFor(input.kind, input.recurrence.kind === 'one_time')
    : existing.recurrenceKind

  try {
    await ctx.db(async (tx) => {
      await tx
        .update(complianceObligations)
        .set({
          title: input.title.trim() || meta.label,
          notes: input.notes ?? null,
          targetRef: ref,
          recurrence,
          recurrenceKind: recurrenceKind as never,
        })
        .where(eq(complianceObligations.id, id))
      // Replace the audience set wholesale — the unique (obligation, kind,
      // entityKey) index makes a diff pointless at this scale.
      await tx.delete(complianceAudience).where(eq(complianceAudience.obligationId, id))
      if (audienceRows.length > 0) {
        await tx.insert(complianceAudience).values(
          audienceRows.map((a) => ({
            tenantId: ctx.tenantId,
            obligationId: id,
            kind: a.kind as never,
            entityKey: a.entityKey,
          })),
        )
      }
    })
    await recordAudit(ctx, {
      entityType: 'compliance_obligation',
      entityId: id,
      action: 'update',
      summary: `Updated ${kindLabel(input.kind)} obligation "${input.title.trim() || meta.label}"`,
    })
    await rematerialize(ctx, id)
    revalidatePath('/compliance/obligations')
    revalidatePath(`/compliance/obligations/${id}`)
    return { ok: true, id, kind: input.kind }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to update obligation' }
  }
}

export async function setObligationEnabled(
  id: string,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'compliance.manage')
  await ctx.db((tx) =>
    tx
      .update(complianceObligations)
      .set({ status: enabled ? 'active' : 'paused' })
      .where(eq(complianceObligations.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'compliance_obligation',
    entityId: id,
    action: 'update',
    summary: enabled ? 'Enabled compliance obligation' : 'Disabled compliance obligation',
  })
  // Re-enabling brings it back into the scoreboard immediately rather than
  // waiting for the daily scan; the hub filters paused obligations out, so
  // disabling needs no scoreboard work.
  if (enabled) await rematerialize(ctx, id)
  revalidatePath('/compliance/obligations')
  revalidatePath(`/compliance/obligations/${id}`)
  return { ok: true }
}

export async function deleteObligation(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'compliance.manage')
  await ctx.db(async (tx) => {
    await tx
      .update(complianceObligations)
      .set({ deletedAt: new Date(), status: 'archived' })
      .where(eq(complianceObligations.id, id))
    // The obligation row is kept (soft delete / audit trail) but its scoreboard
    // rows are dead weight — purge them.
    await tx.delete(complianceStatus).where(eq(complianceStatus.obligationId, id))
  })
  await recordAudit(ctx, {
    entityType: 'compliance_obligation',
    entityId: id,
    action: 'delete',
    summary: 'Deleted compliance obligation',
  })
  revalidatePath('/compliance/obligations')
  revalidatePath(`/compliance/obligations/${id}`)
  return { ok: true }
}
