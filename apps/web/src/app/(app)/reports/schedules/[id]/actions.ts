'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { assertCan } from '@beaconhs/tenant'
import { reportSchedules } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { computeNextRunAt } from '@beaconhs/reports'
import { enqueueReportRun } from '@beaconhs/jobs'
import { loadDefinitionById } from '../../_definitions'
import { parseScheduleForm } from '../_parse'

export async function setActive(scheduleId: string, active: boolean): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.schedule')
  await ctx.db(async (tx) => {
    await tx.update(reportSchedules).set({ active }).where(eq(reportSchedules.id, scheduleId))
  })
  await recordAudit(ctx, {
    entityType: 'report_schedule',
    entityId: scheduleId,
    action: active ? 'publish' : 'archive',
    summary: active ? 'Activated report schedule' : 'Paused report schedule',
  })
  revalidatePath(`/reports/schedules/${scheduleId}`)
  revalidatePath('/reports')
}

export async function triggerNow(scheduleId: string): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.schedule')
  // Load the schedule from the tenant context.
  const schedule = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(reportSchedules)
      .where(eq(reportSchedules.id, scheduleId))
      .limit(1)
    return row ?? null
  })
  if (!schedule) throw new Error('Schedule not found')
  await enqueueReportRun({ tenantId: ctx.tenantId, scheduleId })
  await recordAudit(ctx, {
    entityType: 'report_schedule',
    entityId: scheduleId,
    action: 'export',
    summary: 'Triggered ad-hoc report run',
  })
  revalidatePath(`/reports/schedules/${scheduleId}`)
}

export async function updateSchedule(scheduleId: string, formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.schedule')

  const definitionId = String(formData.get('definitionId') ?? '').trim()
  if (!definitionId) throw new Error('Report definition is required')

  const {
    name,
    cadence,
    dayOfWeek,
    dayOfMonth,
    hour,
    minute,
    timezone,
    recipientUserIds,
    recipientEmails,
    filters,
  } = parseScheduleForm(formData)

  // The definition must be visible to this tenant (built-in or owned).
  const def = await loadDefinitionById(ctx.tenantId!, definitionId)
  if (!def) throw new Error('Unknown report definition')

  const nextRunAt = computeNextRunAt({
    cadence,
    dayOfWeek,
    dayOfMonth,
    hour,
    minute,
    timezone,
  })

  await ctx.db(async (tx) => {
    await tx
      .update(reportSchedules)
      .set({
        definitionId,
        name,
        cadence,
        dayOfWeek,
        dayOfMonth,
        hour,
        minute,
        timezone,
        recipientUserIds,
        recipientEmails,
        filters,
        nextRunAt,
      })
      .where(eq(reportSchedules.id, scheduleId))
  })

  await recordAudit(ctx, {
    entityType: 'report_schedule',
    entityId: scheduleId,
    action: 'update',
    summary: `Updated report schedule "${name}"`,
    after: {
      name,
      definitionId,
      cadence,
      dayOfWeek,
      dayOfMonth,
      hour,
      minute,
      timezone,
      recipientEmails,
      recipientUserIds,
    },
  })

  revalidatePath(`/reports/schedules/${scheduleId}`)
  revalidatePath('/reports')
}

export async function deleteSchedule(scheduleId: string): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.schedule')
  await ctx.db(async (tx) => {
    // Runs cascade-delete via FK.
    await tx.delete(reportSchedules).where(eq(reportSchedules.id, scheduleId))
  })
  await recordAudit(ctx, {
    entityType: 'report_schedule',
    entityId: scheduleId,
    action: 'delete',
    summary: 'Deleted report schedule',
  })
  revalidatePath('/reports')
  redirect('/reports')
}
