'use server'

// Unified obligation CRUD — writes the ONE `compliance_obligations` table for
// every authorable requirement kind. Completion is computed by the adapters in
// @beaconhs/compliance and materialised into compliance_status on create + by
// the daily worker scan.

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  type ComplianceRecurrence,
  type ComplianceTargetRef,
  complianceAudience,
  complianceObligations,
  complianceStatus,
} from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import {
  ComplianceAudienceTargetError,
  ComplianceTargetError,
  lockComplianceAudienceTargets,
  lockComplianceTarget,
  materializeObligation,
  resolveComplianceClock,
  skipQueuedComplianceDispatches,
  validateCronRecurrence,
  validateFrequencyRecurrence,
} from '@beaconhs/compliance'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import { type RecurrenceValue, frequencyToCron } from '@/components/recurrence'
import { parseObligationInput, type ObligationInput } from './_input'
import { KIND_META, type ObligationKind, kindLabel } from './_meta'
import { obligationSemanticConfigChanged } from './_semantic-config'

export type { ObligationInput } from './_input'

type ObligationResult =
  { ok: true; id: string; kind: ObligationKind } | { ok: false; error: string }

class ObligationActionError extends Error {}

function expectedError(message: string): never {
  throw new ObligationActionError(message)
}

function publicMutationError(error: unknown, fallback: string): string {
  return error instanceof ObligationActionError ||
    error instanceof ComplianceTargetError ||
    error instanceof ComplianceAudienceTargetError
    ? error.message
    : fallback
}

function revalidateObligationPaths(id?: string): void {
  try {
    revalidatePath('/compliance/obligations')
    if (id) revalidatePath(`/compliance/obligations/${id}`)
  } catch (error) {
    // The database transaction has already committed. Cache invalidation must
    // never turn a successful mutation into a false failure that users retry.
    console.error('[compliance-obligation] cache revalidation failed', error)
  }
}

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
    return {
      kind: 'cron',
      frequency: r.frequency ?? 'week',
      cron: cronFor(),
      dueOffsetMinutes: r.dueOffsetMinutes,
    }
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
  // Inspection / journal / hazard assessment → frequency.
  return {
    kind: 'frequency',
    frequency: r.frequency ?? 'week',
    cron: cronFor(),
    quantity: Math.max(1, r.quantity ?? 1),
    compliantPercentage: Math.max(0, Math.min(100, r.compliantPercentage ?? 100)),
    dueOffsetMinutes: r.dueOffsetMinutes,
  }
}

function assertValidRecurrence(
  recurrence: ComplianceRecurrence,
  clock: Awaited<ReturnType<typeof resolveComplianceClock>>,
): void {
  try {
    if (recurrence.kind === 'frequency') validateFrequencyRecurrence(recurrence, clock)
    else if (recurrence.kind === 'cron') validateCronRecurrence(recurrence, clock)
  } catch (error) {
    expectedError(error instanceof Error ? error.message : 'The recurrence is invalid')
  }
}

// Audience rows (per_person only). Journal with no picks ⇒ everyone.
function buildAudienceRows(input: ObligationInput): {
  rows: { kind: ObligationInput['audience'][number]['type']; entityKey: string }[]
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

async function lockObligation(tx: Database, tenantId: string, id: string) {
  const [obligation] = await tx
    .select()
    .from(complianceObligations)
    .where(
      and(
        eq(complianceObligations.tenantId, tenantId),
        eq(complianceObligations.id, id),
        isNull(complianceObligations.deletedAt),
      ),
    )
    .limit(1)
    .for('update')
  if (!obligation) expectedError('Obligation not found')
  return obligation
}

async function purgeMaterializedStatus(tx: Database, tenantId: string, id: string): Promise<void> {
  await tx
    .delete(complianceStatus)
    .where(and(eq(complianceStatus.tenantId, tenantId), eq(complianceStatus.obligationId, id)))
}

async function setEnabledInTransaction(
  tx: Database,
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  existing: Awaited<ReturnType<typeof lockObligation>>,
  id: string,
  enabled: boolean,
): Promise<void> {
  const [updated] = await tx
    .update(complianceObligations)
    .set({ status: enabled ? 'active' : 'paused' })
    .where(
      and(
        eq(complianceObligations.tenantId, ctx.tenantId),
        eq(complianceObligations.id, id),
        isNull(complianceObligations.deletedAt),
      ),
    )
    .returning()
  if (!updated) expectedError('Obligation not found')

  if (enabled) {
    await materializeObligation(tx, ctx.tenantId, updated)
  } else {
    await purgeMaterializedStatus(tx, ctx.tenantId, id)
    await skipQueuedComplianceDispatches(tx, ctx.tenantId, id)
  }
  await recordAuditInTransaction(tx, ctx, {
    entityType: 'compliance_obligation',
    entityId: id,
    action: 'update',
    summary: enabled ? 'Enabled compliance obligation' : 'Disabled compliance obligation',
    before: { status: existing.status },
    after: { status: updated.status },
  })
}

export async function createObligation(rawInput: ObligationInput): Promise<ObligationResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'compliance.assign')
  const parsed = parseObligationInput(rawInput)
  if (!parsed.ok) return parsed
  const input = parsed.value
  const meta = KIND_META[input.kind]

  if (input.kind === 'journal' && !input.title.trim())
    return { ok: false, error: 'Name is required' }
  const { ref, error } = buildTargetRef(input)
  if (error) return { ok: false, error }

  const { rows: audienceRows, error: audienceError } = buildAudienceRows(input)
  if (audienceError) return { ok: false, error: audienceError }

  const recurrence = buildRecurrence(input.kind, input.recurrence)
  const recurrenceKind = recurrence.kind

  let id: string
  try {
    id = await ctx.db(async (tx) => {
      if (recurrence.kind === 'frequency' || recurrence.kind === 'cron') {
        const clock = await resolveComplianceClock(tx, ctx.tenantId)
        assertValidRecurrence(recurrence, clock)
      }
      await lockComplianceTarget(tx, ctx.tenantId, input.kind, ref)
      await lockComplianceAudienceTargets(tx, ctx.tenantId, audienceRows)
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
        .returning()
      if (!row) throw new Error('Failed to create obligation')
      if (audienceRows.length > 0) {
        await tx.insert(complianceAudience).values(
          audienceRows.map((a) => ({
            tenantId: ctx.tenantId,
            obligationId: row.id,
            kind: a.kind as never,
            entityKey: a.entityKey,
          })),
        )
      }
      await materializeObligation(tx, ctx.tenantId, row)
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'compliance_obligation',
        entityId: row.id,
        action: 'create',
        summary: `Created ${kindLabel(input.kind)} obligation "${input.title.trim() || meta.label}"`,
      })
      return row.id
    })
  } catch (err) {
    return { ok: false, error: publicMutationError(err, 'Failed to create obligation') }
  }
  revalidateObligationPaths()
  return { ok: true, id, kind: input.kind }
}

export async function updateObligation(
  id: string,
  rawInput: ObligationInput,
): Promise<ObligationResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'compliance.manage')
  const parsed = parseObligationInput(rawInput)
  if (!parsed.ok) return parsed
  const input = parsed.value
  const meta = KIND_META[input.kind]

  if (input.kind === 'journal' && !input.title.trim())
    return { ok: false, error: 'Name is required' }
  const { ref, error } = buildTargetRef(input)
  if (error) return { ok: false, error }

  const { rows: audienceRows, error: audienceError } = buildAudienceRows(input)
  if (audienceError) return { ok: false, error: audienceError }

  try {
    await ctx.db(async (tx) => {
      // Identity and target lifecycle writers lock their owner row before
      // rematerializing obligations. Match that outer lock order here to avoid
      // obligation↔catalog deadlocks.
      await lockComplianceTarget(tx, ctx.tenantId, input.kind, ref)
      await lockComplianceAudienceTargets(tx, ctx.tenantId, audienceRows)
      const existing = await lockObligation(tx, ctx.tenantId, id)
      // The kind determines the subject shape, target and evaluation adapter —
      // it is fixed at creation. Delete + recreate to change it.
      if (existing.sourceModule !== input.kind)
        expectedError('The kind of an obligation cannot be changed')

      // Kinds with no schedule knobs in the form (cert / equipment / PPE /
      // job-title) keep their stored recurrence untouched — rebuilding would
      // clobber values authored elsewhere (e.g. the ETL fold-in).
      const hasScheduleKnobs = Object.values(meta.recurrence).some(Boolean)
      const recurrence = hasScheduleKnobs
        ? buildRecurrence(input.kind, input.recurrence)
        : existing.recurrence
      const recurrenceKind = recurrence.kind

      if (recurrence.kind === 'frequency' || recurrence.kind === 'cron') {
        const clock = await resolveComplianceClock(tx, ctx.tenantId)
        assertValidRecurrence(recurrence, clock)
      }
      const previousAudience = await tx
        .select({ kind: complianceAudience.kind, entityKey: complianceAudience.entityKey })
        .from(complianceAudience)
        .where(
          and(
            eq(complianceAudience.tenantId, ctx.tenantId),
            eq(complianceAudience.obligationId, id),
          ),
        )
      const semanticConfigChanged = obligationSemanticConfigChanged(
        {
          targetRef: existing.targetRef,
          recurrence: existing.recurrence,
          audience: previousAudience,
        },
        { targetRef: ref, recurrence, audience: audienceRows },
      )
      const [updated] = await tx
        .update(complianceObligations)
        .set({
          title: input.title.trim() || meta.label,
          notes: input.notes ?? null,
          targetRef: ref,
          recurrence,
          recurrenceKind: recurrenceKind as never,
        })
        .where(
          and(
            eq(complianceObligations.tenantId, ctx.tenantId),
            eq(complianceObligations.id, id),
            isNull(complianceObligations.deletedAt),
          ),
        )
        .returning()
      if (!updated) expectedError('Obligation not found')
      // Replace the audience set wholesale — the unique (obligation, kind,
      // entityKey) index makes a diff pointless at this scale.
      await tx
        .delete(complianceAudience)
        .where(
          and(
            eq(complianceAudience.tenantId, ctx.tenantId),
            eq(complianceAudience.obligationId, id),
          ),
        )
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
      if (semanticConfigChanged) {
        // Durable dispatches snapshot the old target/audience/schedule. Retire
        // unpublished work before rebuilding from an empty status baseline so
        // current actionable subjects receive a replacement, current alert.
        await purgeMaterializedStatus(tx, ctx.tenantId, id)
        await skipQueuedComplianceDispatches(
          tx,
          ctx.tenantId,
          id,
          'Compliance obligation targeting or schedule changed',
        )
      }
      if (updated.status === 'active') {
        await materializeObligation(tx, ctx.tenantId, updated)
      } else {
        await purgeMaterializedStatus(tx, ctx.tenantId, id)
        await skipQueuedComplianceDispatches(tx, ctx.tenantId, id)
      }
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'compliance_obligation',
        entityId: id,
        action: 'update',
        summary: `Updated ${kindLabel(input.kind)} obligation "${input.title.trim() || meta.label}"`,
      })
    })
  } catch (err) {
    return { ok: false, error: publicMutationError(err, 'Failed to update obligation') }
  }
  revalidateObligationPaths(id)
  return { ok: true, id, kind: input.kind }
}

export async function setObligationEnabled(
  id: string,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'compliance.manage')
  try {
    await ctx.db(async (tx) => {
      if (enabled) {
        const [snapshot] = await tx
          .select()
          .from(complianceObligations)
          .where(
            and(
              eq(complianceObligations.tenantId, ctx.tenantId),
              eq(complianceObligations.id, id),
              isNull(complianceObligations.deletedAt),
            ),
          )
          .limit(1)
        if (!snapshot) expectedError('Obligation not found')
        const audience = await tx
          .select({ kind: complianceAudience.kind, entityKey: complianceAudience.entityKey })
          .from(complianceAudience)
          .where(
            and(
              eq(complianceAudience.tenantId, ctx.tenantId),
              eq(complianceAudience.obligationId, id),
            ),
          )
        await lockComplianceTarget(tx, ctx.tenantId, snapshot.sourceModule, snapshot.targetRef)
        await lockComplianceAudienceTargets(tx, ctx.tenantId, audience)
        const existing = await lockObligation(tx, ctx.tenantId, id)
        if (existing.updatedAt.getTime() !== snapshot.updatedAt.getTime()) {
          expectedError('The obligation changed while it was being enabled; try again')
        }
        await setEnabledInTransaction(tx, ctx, existing, id, true)
        return
      }
      const existing = await lockObligation(tx, ctx.tenantId, id)
      await setEnabledInTransaction(tx, ctx, existing, id, false)
    })
  } catch (err) {
    return { ok: false, error: publicMutationError(err, 'Failed to update obligation') }
  }
  revalidateObligationPaths(id)
  return { ok: true }
}

export async function deleteObligation(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'compliance.manage')
  try {
    await ctx.db(async (tx) => {
      const existing = await lockObligation(tx, ctx.tenantId, id)

      const deletedAt = new Date()
      const [deleted] = await tx
        .update(complianceObligations)
        .set({ deletedAt, status: 'archived' })
        .where(
          and(
            eq(complianceObligations.tenantId, ctx.tenantId),
            eq(complianceObligations.id, id),
            isNull(complianceObligations.deletedAt),
          ),
        )
        .returning({ status: complianceObligations.status })
      if (!deleted) expectedError('Obligation not found')

      // The obligation row is kept for its audit trail, but its materialized
      // status rows must disappear in the same transaction.
      await purgeMaterializedStatus(tx, ctx.tenantId, id)
      await skipQueuedComplianceDispatches(tx, ctx.tenantId, id)
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'compliance_obligation',
        entityId: id,
        action: 'delete',
        summary: 'Deleted compliance obligation',
        before: { status: existing.status, deletedAt: null },
        after: { status: deleted.status, deletedAt: deletedAt.toISOString() },
      })
    })
  } catch (err) {
    return { ok: false, error: publicMutationError(err, 'Failed to delete obligation') }
  }
  revalidateObligationPaths(id)
  return { ok: true }
}
