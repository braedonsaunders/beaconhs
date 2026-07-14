'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { assertCan } from '@beaconhs/tenant'
import { reportSchedules } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { claimReportRun } from '@beaconhs/reports'
import { enqueueReportRun } from '@beaconhs/jobs'
import { requireUuidInput } from '@/lib/mutation-input'
import { prepareScheduleMutation } from '../_mutation'

export async function setActive(scheduleId: string, active: boolean): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.schedule')
  if (!ctx.membership) throw new Error('An active tenant membership is required to edit schedules')
  if (typeof active !== 'boolean') throw new Error('Schedule state is invalid')
  const normalizedScheduleId = requireUuidInput(scheduleId, 'Report schedule')
  const runAsTenantUserId = ctx.membership.id
  const updated = await ctx.db(async (tx) => {
    const [row] = await tx
      .update(reportSchedules)
      .set({
        active,
        ...(active ? { runAsTenantUserId, runAsRoleId: ctx.activeRoleId ?? null } : {}),
      })
      .where(eq(reportSchedules.id, normalizedScheduleId))
      .returning({ id: reportSchedules.id })
    return row ?? null
  })
  if (!updated) throw new Error('Schedule not found')
  await recordAudit(ctx, {
    entityType: 'report_schedule',
    entityId: normalizedScheduleId,
    action: active ? 'publish' : 'archive',
    summary: active ? 'Activated report schedule' : 'Paused report schedule',
  })
  revalidatePath(`/reports/schedules/${normalizedScheduleId}`)
  revalidatePath('/reports')
}

export async function triggerNow(scheduleId: string): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.schedule')
  if (!ctx.membership) throw new Error('An active tenant membership is required to run schedules')
  const normalizedScheduleId = requireUuidInput(scheduleId, 'Report schedule')
  const runAsTenantUserId = ctx.membership.id
  const runId = await ctx.db(async (tx) => {
    const [updated] = await tx
      .update(reportSchedules)
      .set({ runAsTenantUserId, runAsRoleId: ctx.activeRoleId ?? null })
      .where(eq(reportSchedules.id, normalizedScheduleId))
      .returning({ id: reportSchedules.id })
    if (!updated) throw new Error('Schedule not found')
    const run = await claimReportRun(tx, {
      scheduleId: normalizedScheduleId,
      scheduledFor: new Date(),
      trigger: 'manual',
    })
    return run.id
  })
  await enqueueReportRun({ tenantId: ctx.tenantId, scheduleId: normalizedScheduleId, runId })
  await recordAudit(ctx, {
    entityType: 'report_schedule',
    entityId: normalizedScheduleId,
    action: 'export',
    summary: 'Triggered ad-hoc report run',
    metadata: { runId },
  })
  revalidatePath(`/reports/schedules/${normalizedScheduleId}`)
}

export async function updateSchedule(scheduleId: string, formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.schedule')
  if (!ctx.membership) throw new Error('An active tenant membership is required to edit schedules')
  const normalizedScheduleId = requireUuidInput(scheduleId, 'Report schedule')
  const runAsTenantUserId = ctx.membership.id

  const {
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
  } = await prepareScheduleMutation(ctx, formData)

  const updated = await ctx.db(async (tx) => {
    const [row] = await tx
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
        runAsTenantUserId,
        runAsRoleId: ctx.activeRoleId ?? null,
        nextRunAt,
      })
      .where(eq(reportSchedules.id, normalizedScheduleId))
      .returning({ id: reportSchedules.id })
    return row ?? null
  })
  if (!updated) throw new Error('Schedule not found')

  await recordAudit(ctx, {
    entityType: 'report_schedule',
    entityId: normalizedScheduleId,
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

  revalidatePath(`/reports/schedules/${normalizedScheduleId}`)
  revalidatePath('/reports')
}

export async function deleteSchedule(scheduleId: string): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.schedule')
  const normalizedScheduleId = requireUuidInput(scheduleId, 'Report schedule')
  const deleted = await ctx.db(async (tx) => {
    // Runs cascade-delete via FK.
    const [row] = await tx
      .delete(reportSchedules)
      .where(eq(reportSchedules.id, normalizedScheduleId))
      .returning({ id: reportSchedules.id })
    return row ?? null
  })
  if (!deleted) throw new Error('Schedule not found')
  await recordAudit(ctx, {
    entityType: 'report_schedule',
    entityId: normalizedScheduleId,
    action: 'delete',
    summary: 'Deleted report schedule',
  })
  revalidatePath('/reports')
  redirect('/reports')
}
