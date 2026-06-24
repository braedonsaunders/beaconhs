'use server'

// Server actions for the training-class record page.
//
//   updateClassField  per-field auto-save ({id, field, value}) for the shared
//                     LiveField primitives — the single-page unified create/edit/
//                     view surface (mirrors the incident / hazard-assessment
//                     detail pages). Completed classes are locked.
//   cancelClass /     soft lifecycle: cancel keeps the record (audit) but marks
//   reopenClass       it off the schedule; reopen clears it. Header actions,
//                     mirroring locations archive/restore.

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { trainingClasses } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

const CLASS_REQUIRED_IDS = new Set(['courseId'])
const CLASS_NULLABLE_IDS = new Set(['siteOrgUnitId', 'instructorTenantUserId'])
const CLASS_TIMESTAMPS = new Set(['startsAt', 'endsAt'])
const CLASS_INTS = new Set(['capacity'])
const CLASS_TEXT_NOTNULL = new Set(['title'])
const CLASS_TEXT = new Set(['notes'])

export async function updateClassField(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const field = String(formData.get('field') ?? '')
  const raw = formData.get('value')
  const value = typeof raw === 'string' ? raw : ''
  if (!id || !field) throw new Error('Missing id/field')

  const allowed =
    CLASS_REQUIRED_IDS.has(field) ||
    CLASS_NULLABLE_IDS.has(field) ||
    CLASS_TIMESTAMPS.has(field) ||
    CLASS_INTS.has(field) ||
    CLASS_TEXT_NOTNULL.has(field) ||
    CLASS_TEXT.has(field)
  if (!allowed) throw new Error('Field not allowed')

  const before = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ completedAt: trainingClasses.completedAt })
      .from(trainingClasses)
      .where(eq(trainingClasses.id, id))
      .limit(1)
    return row ?? null
  })
  if (!before) throw new Error('Class not found')
  if (before.completedAt) throw new Error('Class is complete')

  let val: unknown
  if (CLASS_REQUIRED_IDS.has(field)) {
    if (!value) throw new Error('This field is required')
    val = value
  } else if (CLASS_NULLABLE_IDS.has(field)) {
    val = value || null
  } else if (CLASS_TIMESTAMPS.has(field)) {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) throw new Error('Invalid date')
    val = d
  } else if (CLASS_INTS.has(field)) {
    if (value.trim() === '') val = null
    else {
      const n = Number.parseInt(value, 10)
      if (Number.isNaN(n)) throw new Error('Invalid number')
      val = n
    }
  } else if (CLASS_TEXT_NOTNULL.has(field)) {
    if (value.trim() === '') throw new Error('This field is required')
    val = value
  } else {
    val = value.trim() === '' ? null : value
  }

  await ctx.db((tx) =>
    tx
      .update(trainingClasses)
      .set({ [field]: val } as any)
      .where(eq(trainingClasses.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'training_class',
    entityId: id,
    action: 'update',
    summary: `Updated ${field}`,
    after: { [field]: val },
  })
  revalidatePath(`/training/classes/${id}`)
  revalidatePath('/training/classes')
}

export async function cancelClass(id: string, _formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  if (!id) return
  await ctx.db((tx) =>
    tx.update(trainingClasses).set({ cancelledAt: new Date() }).where(eq(trainingClasses.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'training_class',
    entityId: id,
    action: 'update',
    summary: 'Cancelled training class',
  })
  revalidatePath(`/training/classes/${id}`)
  revalidatePath('/training/classes')
}

export async function reopenClass(id: string, _formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  if (!id) return
  await ctx.db((tx) =>
    tx.update(trainingClasses).set({ cancelledAt: null }).where(eq(trainingClasses.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'training_class',
    entityId: id,
    action: 'update',
    summary: 'Reopened training class',
  })
  revalidatePath(`/training/classes/${id}`)
  revalidatePath('/training/classes')
}
