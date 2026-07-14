'use server'

// Server actions for equipment maintenance scheduling: per-unit inspection
// schedules (recurring cadences) and ad-hoc reminders. Shared by the asset
// detail page (Inspections tab) and the maintenance cockpit.

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import {
  equipmentInspectionSchedules,
  equipmentInspectionTypes,
  equipmentItems,
  equipmentReminders,
  people,
} from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit, recordAuditInTransaction } from '@/lib/audit'
import { materializeEquipmentTypeEvidence } from '@/lib/compliance-type-evidence'
import { moduleScopeWhere } from '@/lib/visibility'
import {
  addIntervalToDate,
  formatInterval,
  parseIntervalUnit,
  type EquipmentIntervalUnit,
} from '@/lib/equipment/intervals'
import {
  optionalTextInput,
  optionalUuidInput,
  requiredDateInput,
  requiredTextInput,
  requireUuidInput,
} from '@/lib/mutation-input'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function revalidateMaintenance(itemId: string) {
  revalidatePath(`/equipment/${itemId}`)
  revalidatePath('/equipment/maintenance')
}

function parseValueUnit(
  rawValue: number | null | undefined,
  rawUnit: string | null | undefined,
): { value: number; unit: EquipmentIntervalUnit } | null {
  const unit = parseIntervalUnit(rawUnit)
  const value =
    typeof rawValue === 'number' && Number.isFinite(rawValue)
      ? Math.max(1, Math.min(120, Math.trunc(rawValue)))
      : null
  return unit && value ? { value, unit } : null
}

// --- inspection schedules ----------------------------------------------------

export async function saveEquipmentSchedule(input: {
  id?: string
  equipmentItemId: string
  inspectionTypeId: string | null
  label: string | null
  intervalValue: number
  intervalUnit: string
  nextDueOn: string
  notes: string | null
  isActive: boolean
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')

  const interval = parseValueUnit(input.intervalValue, input.intervalUnit)
  if (!interval) return { ok: false, error: 'Enter a valid interval.' }
  if (!DATE_RE.test(input.nextDueOn)) return { ok: false, error: 'Next due date is required.' }
  const label = input.label?.trim() || null
  const inspectionTypeId = input.inspectionTypeId || null
  if (!inspectionTypeId && !label) {
    return { ok: false, error: 'Pick an inspection type or name the schedule.' }
  }

  const result = await ctx.db(async (tx) => {
    const [item] = await tx
      .select({ id: equipmentItems.id, name: equipmentItems.name, typeId: equipmentItems.typeId })
      .from(equipmentItems)
      .where(and(eq(equipmentItems.id, input.equipmentItemId), isNull(equipmentItems.deletedAt)))
      .limit(1)
      .for('update')
    if (!item) return null
    if (inspectionTypeId) {
      const [type] = await tx
        .select({ id: equipmentInspectionTypes.id })
        .from(equipmentInspectionTypes)
        .where(eq(equipmentInspectionTypes.id, inspectionTypeId))
        .limit(1)
      if (!type) return null
    }
    const values = {
      inspectionTypeId,
      label,
      intervalValue: interval.value,
      intervalUnit: interval.unit,
      nextDueOn: input.nextDueOn,
      notes: input.notes?.trim() || null,
      isActive: input.isActive,
    }
    if (input.id) {
      const [row] = await tx
        .update(equipmentInspectionSchedules)
        .set({ ...values, updatedAt: new Date() })
        .where(
          and(
            eq(equipmentInspectionSchedules.id, input.id),
            eq(equipmentInspectionSchedules.equipmentItemId, input.equipmentItemId),
          ),
        )
        .returning({ id: equipmentInspectionSchedules.id })
      if (!row) return null
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'equipment',
        entityId: input.equipmentItemId,
        action: 'update',
        summary: `Updated inspection schedule (${formatInterval(interval.value, interval.unit)})`,
        after: { scheduleId: row.id, inspectionTypeId, label, nextDueOn: input.nextDueOn },
      })
      await materializeEquipmentTypeEvidence(tx, ctx.tenantId, [item.typeId])
      return { id: row.id, created: false }
    }
    const [row] = await tx
      .insert(equipmentInspectionSchedules)
      .values({
        tenantId: ctx.tenantId,
        equipmentItemId: input.equipmentItemId,
        ...values,
        createdByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning({ id: equipmentInspectionSchedules.id })
    if (!row) return null
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'equipment',
      entityId: input.equipmentItemId,
      action: 'update',
      summary: `Added inspection schedule (${formatInterval(interval.value, interval.unit)})`,
      after: { scheduleId: row.id, inspectionTypeId, label, nextDueOn: input.nextDueOn },
    })
    await materializeEquipmentTypeEvidence(tx, ctx.tenantId, [item.typeId])
    return { id: row.id, created: true }
  })
  if (!result) return { ok: false, error: 'Failed to save schedule.' }
  revalidateMaintenance(input.equipmentItemId)
  return { ok: true }
}

export async function deleteEquipmentSchedule(input: {
  id: string
  equipmentItemId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  const deleted = await ctx.db(async (tx) => {
    const [item] = await tx
      .select({ id: equipmentItems.id, typeId: equipmentItems.typeId })
      .from(equipmentItems)
      .where(and(eq(equipmentItems.id, input.equipmentItemId), isNull(equipmentItems.deletedAt)))
      .limit(1)
      .for('update')
    if (!item) return false
    const [row] = await tx
      .delete(equipmentInspectionSchedules)
      .where(
        and(
          eq(equipmentInspectionSchedules.id, input.id),
          eq(equipmentInspectionSchedules.equipmentItemId, input.equipmentItemId),
        ),
      )
      .returning({ id: equipmentInspectionSchedules.id })
    if (!row) return false
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'equipment',
      entityId: input.equipmentItemId,
      action: 'update',
      summary: 'Removed inspection schedule',
      before: { scheduleId: input.id },
    })
    await materializeEquipmentTypeEvidence(tx, ctx.tenantId, [item.typeId])
    return true
  })
  if (!deleted) return { ok: false, error: 'Schedule not found.' }
  revalidateMaintenance(input.equipmentItemId)
  return { ok: true }
}

// --- reminders ----------------------------------------------------------------

export async function saveEquipmentReminder(input: {
  id?: string
  equipmentItemId: string
  title: string
  details: string | null
  dueOn: string
  repeatIntervalValue: number | null
  repeatIntervalUnit: string | null
  assignedToPersonId: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')

  let parsed: {
    id: string | null
    equipmentItemId: string
    title: string
    details: string | null
    dueOn: string
    assignedToPersonId: string | null
  }
  try {
    parsed = {
      id: optionalUuidInput(input.id, 'Reminder'),
      equipmentItemId: requireUuidInput(input.equipmentItemId, 'Equipment item'),
      title: requiredTextInput(input.title, 'Title', 500),
      details: optionalTextInput(input.details, 'Details', 10_000),
      dueOn: requiredDateInput(input.dueOn, 'Due date'),
      assignedToPersonId: optionalUuidInput(input.assignedToPersonId, 'Assignee'),
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid reminder.' }
  }
  const repeat = parseValueUnit(input.repeatIntervalValue, input.repeatIntervalUnit)

  const saved = await ctx.db(async (tx) => {
    const scope = await moduleScopeWhere(ctx, tx, {
      prefix: 'equipment',
      siteCol: equipmentItems.currentSiteOrgUnitId,
      personCol: equipmentItems.currentHolderPersonId,
    })
    const [item] = await tx
      .select({ id: equipmentItems.id, status: equipmentItems.status })
      .from(equipmentItems)
      .where(
        and(eq(equipmentItems.id, parsed.equipmentItemId), isNull(equipmentItems.deletedAt), scope),
      )
      .limit(1)
    if (!item) return { ok: false as const, error: 'Equipment item was not found.' }
    if (!parsed.id && (item.status === 'retired' || item.status === 'lost')) {
      return { ok: false as const, error: 'Select an active equipment item.' }
    }
    if (parsed.assignedToPersonId) {
      const [assignee] = await tx
        .select({ id: people.id })
        .from(people)
        .where(
          and(
            eq(people.id, parsed.assignedToPersonId),
            eq(people.status, 'active'),
            isNull(people.deletedAt),
          ),
        )
        .limit(1)
      if (!assignee) return { ok: false as const, error: 'Select an active assignee.' }
    }
    const values = {
      title: parsed.title,
      details: parsed.details,
      dueOn: parsed.dueOn,
      repeatIntervalValue: repeat?.value ?? null,
      repeatIntervalUnit: repeat?.unit ?? null,
      assignedToPersonId: parsed.assignedToPersonId,
    }
    if (parsed.id) {
      const [row] = await tx
        .update(equipmentReminders)
        .set({ ...values, updatedAt: new Date() })
        .where(
          and(
            eq(equipmentReminders.id, parsed.id),
            eq(equipmentReminders.equipmentItemId, parsed.equipmentItemId),
          ),
        )
        .returning({ id: equipmentReminders.id })
      return row
        ? { ok: true as const, id: row.id, created: false }
        : { ok: false as const, error: 'Reminder was not found.' }
    }
    const [row] = await tx
      .insert(equipmentReminders)
      .values({
        tenantId: ctx.tenantId,
        equipmentItemId: parsed.equipmentItemId,
        ...values,
        createdByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning({ id: equipmentReminders.id })
    return row
      ? { ok: true as const, id: row.id, created: true }
      : { ok: false as const, error: 'Reminder was not saved.' }
  })
  if (!saved.ok) return saved

  await recordAudit(ctx, {
    entityType: 'equipment',
    entityId: parsed.equipmentItemId,
    action: 'update',
    summary: `${saved.created ? 'Added' : 'Updated'} reminder "${parsed.title}" (due ${parsed.dueOn})`,
    after: { reminderId: saved.id, dueOn: parsed.dueOn },
  })
  revalidateMaintenance(parsed.equipmentItemId)
  return { ok: true }
}

/**
 * Mark a reminder done. Repeating reminders spawn the next occurrence (from
 * the reminder's own due date, rolled forward past today for long-overdue
 * completions) so the cadence holds without stacking stale entries.
 */
export async function completeEquipmentReminder(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return

  const done = await ctx.db(async (tx) => {
    const [reminder] = await tx
      .select()
      .from(equipmentReminders)
      .where(and(eq(equipmentReminders.id, id), isNull(equipmentReminders.completedAt)))
      .limit(1)
    if (!reminder) return null
    await tx
      .update(equipmentReminders)
      .set({
        completedAt: new Date(),
        completedByTenantUserId: ctx.membership?.id ?? null,
        updatedAt: new Date(),
      })
      .where(eq(equipmentReminders.id, id))
    if (reminder.repeatIntervalValue && reminder.repeatIntervalUnit) {
      const todayIso = new Date().toISOString().slice(0, 10)
      let nextDue = addIntervalToDate(
        reminder.dueOn,
        reminder.repeatIntervalValue,
        reminder.repeatIntervalUnit,
      )
      while (nextDue < todayIso) {
        nextDue = addIntervalToDate(
          nextDue,
          reminder.repeatIntervalValue,
          reminder.repeatIntervalUnit,
        )
      }
      await tx.insert(equipmentReminders).values({
        tenantId: ctx.tenantId,
        equipmentItemId: reminder.equipmentItemId,
        title: reminder.title,
        details: reminder.details,
        dueOn: nextDue,
        repeatIntervalValue: reminder.repeatIntervalValue,
        repeatIntervalUnit: reminder.repeatIntervalUnit,
        assignedToPersonId: reminder.assignedToPersonId,
        createdByTenantUserId: ctx.membership?.id ?? null,
      })
    }
    return reminder
  })
  if (!done) return

  await recordAudit(ctx, {
    entityType: 'equipment',
    entityId: done.equipmentItemId,
    action: 'update',
    summary: `Completed reminder "${done.title}"`,
    after: { reminderId: id },
  })
  revalidateMaintenance(done.equipmentItemId)
}

export async function deleteEquipmentReminder(input: {
  id: string
  equipmentItemId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  const deleted = await ctx.db(async (tx) => {
    const [row] = await tx
      .delete(equipmentReminders)
      .where(
        and(
          eq(equipmentReminders.id, input.id),
          eq(equipmentReminders.equipmentItemId, input.equipmentItemId),
        ),
      )
      .returning({ id: equipmentReminders.id, title: equipmentReminders.title })
    return row ?? null
  })
  if (!deleted) return { ok: false, error: 'Reminder not found.' }
  await recordAudit(ctx, {
    entityType: 'equipment',
    entityId: input.equipmentItemId,
    action: 'update',
    summary: `Removed reminder "${deleted.title}"`,
    before: { reminderId: input.id },
  })
  revalidateMaintenance(input.equipmentItemId)
  return { ok: true }
}
