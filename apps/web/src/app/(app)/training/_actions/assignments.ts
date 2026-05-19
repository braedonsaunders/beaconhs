'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import {
  trainingAudienceAssignmentRecords,
  trainingAudienceAssignmentTargets,
  trainingAudienceAssignments,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { recomputeAssignmentCompliance } from '../_lib/audience'

type RawTarget =
  | { kind: 'person'; personId: string }
  | { kind: 'trade'; tradeId: string }
  | { kind: 'role'; roleKey: string }
  | { kind: 'everyone' }

/**
 * Parse the targets payload submitted from `assignments/new`. The form sends
 * three multi-select fields (people, trades, roles) plus a single "everyone"
 * checkbox. We funnel those into a deduplicated RawTarget[].
 */
function readTargets(formData: FormData): RawTarget[] {
  const out: RawTarget[] = []
  const everyone = formData.get('everyone') === 'on'
  if (everyone) {
    out.push({ kind: 'everyone' })
    return out
  }
  for (const v of formData.getAll('personId')) {
    const s = String(v).trim()
    if (s) out.push({ kind: 'person', personId: s })
  }
  for (const v of formData.getAll('tradeId')) {
    const s = String(v).trim()
    if (s) out.push({ kind: 'trade', tradeId: s })
  }
  for (const v of formData.getAll('roleKey')) {
    const s = String(v).trim()
    if (s) out.push({ kind: 'role', roleKey: s })
  }
  return out
}

export async function createAudienceAssignment(formData: FormData) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId: string = ctx.tenantId

  const name = String(formData.get('name') ?? '').trim()
  if (!name) throw new Error('Name is required')
  const notes = String(formData.get('notes') ?? '').trim() || null

  const itemKindRaw = String(formData.get('itemKind') ?? 'course').trim()
  if (itemKindRaw !== 'course' && itemKindRaw !== 'assessment_type') {
    throw new Error('Invalid itemKind')
  }
  const itemKind = itemKindRaw as 'course' | 'assessment_type'

  const courseRaw = String(formData.get('courseId') ?? '').trim()
  const assessmentTypeRaw = String(formData.get('assessmentTypeId') ?? '').trim()
  const courseId = itemKind === 'course' && courseRaw ? courseRaw : null
  const assessmentTypeId =
    itemKind === 'assessment_type' && assessmentTypeRaw ? assessmentTypeRaw : null
  if (!courseId && !assessmentTypeId) {
    throw new Error('Pick a course or an assessment type')
  }

  const dueRaw = String(formData.get('dueOn') ?? '').trim()
  const dueOn = dueRaw || null
  const cronRaw = String(formData.get('recurrenceCron') ?? '').trim()
  const recurrenceCron = cronRaw || null
  const remindRaw = String(formData.get('remindBeforeDays') ?? '7').trim()
  const remindBeforeDays = Math.max(0, Math.min(365, Number(remindRaw) || 0))

  const targets = readTargets(formData)
  if (targets.length === 0) throw new Error('Pick at least one audience target')

  const created = await ctx.db(async (tx) => {
    const [a] = await tx
      .insert(trainingAudienceAssignments)
      .values({
        tenantId,
        name,
        notes,
        itemKind,
        courseId,
        assessmentTypeId,
        dueOn,
        recurrenceCron,
        remindBeforeDays,
        status: 'active',
      })
      .returning()
    if (!a) throw new Error('Failed to create assignment')

    await tx.insert(trainingAudienceAssignmentTargets).values(
      targets.map((t) => ({
        tenantId,
        assignmentId: a.id,
        kind: t.kind,
        personId: t.kind === 'person' ? t.personId : null,
        tradeId: t.kind === 'trade' ? t.tradeId : null,
        roleKey: t.kind === 'role' ? t.roleKey : null,
      })),
    )

    // Snapshot compliance up front.
    await recomputeAssignmentCompliance(tx, tenantId, a.id)
    return a
  })

  await recordAudit(ctx, {
    entityType: 'training_audience_assignment',
    entityId: created.id,
    action: 'create',
    summary: `Created training assignment "${name}"`,
    after: { itemKind, courseId, assessmentTypeId, dueOn, targets: targets.length },
  })
  revalidatePath('/training/assignments')
  redirect(`/training/assignments/${created.id}`)
}

export async function refreshAssignmentCompliance(assignmentId: string) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId: string = ctx.tenantId
  await ctx.db(async (tx) => {
    await recomputeAssignmentCompliance(tx, tenantId, assignmentId)
  })
  await recordAudit(ctx, {
    entityType: 'training_audience_assignment',
    entityId: assignmentId,
    action: 'update',
    summary: `Recomputed compliance for ${assignmentId}`,
  })
  revalidatePath(`/training/assignments/${assignmentId}`)
  revalidatePath('/training/assignments')
}

export async function archiveAudienceAssignment(assignmentId: string) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  await ctx.db(async (tx) => {
    await tx
      .update(trainingAudienceAssignments)
      .set({ status: 'archived', deletedAt: new Date() })
      .where(eq(trainingAudienceAssignments.id, assignmentId))
    await tx
      .delete(trainingAudienceAssignmentRecords)
      .where(eq(trainingAudienceAssignmentRecords.assignmentId, assignmentId))
  })
  await recordAudit(ctx, {
    entityType: 'training_audience_assignment',
    entityId: assignmentId,
    action: 'archive',
    summary: `Archived training assignment ${assignmentId}`,
  })
  revalidatePath('/training/assignments')
  redirect('/training/assignments')
}
