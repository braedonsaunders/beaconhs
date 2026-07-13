'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { assertCan } from '@beaconhs/tenant'
import { reportSchedules } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { claimReportRun, computeNextRunAt } from '@beaconhs/reports'
import { enqueueReportRun } from '@beaconhs/jobs'
import { loadDefinitionById } from '../../_definitions'
import { parseScheduleForm } from '../_parse'

export async function setActive(scheduleId: string, active: boolean): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.schedule')
  if (!ctx.membership) throw new Error('An active tenant membership is required to edit schedules')
  const runAsTenantUserId = ctx.membership.id
  await ctx.db(async (tx) => {
    await tx
      .update(reportSchedules)
      .set({
        active,
        ...(active ? { runAsTenantUserId, runAsRoleId: ctx.activeRoleId ?? null } : {}),
      })
      .where(eq(reportSchedules.id, scheduleId))
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
  if (!ctx.membership) throw new Error('An active tenant membership is required to run schedules')
  const runAsTenantUserId = ctx.membership.id
  const runId = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(reportSchedules)
      .where(eq(reportSchedules.id, scheduleId))
      .limit(1)
    if (!row) throw new Error('Schedule not found')
    await tx
      .update(reportSchedules)
      .set({ runAsTenantUserId, runAsRoleId: ctx.activeRoleId ?? null })
      .where(eq(reportSchedules.id, scheduleId))
    const run = await claimReportRun(tx, {
      scheduleId,
      scheduledFor: new Date(),
      trigger: 'manual',
    })
    return run.id
  })
  await enqueueReportRun({ tenantId: ctx.tenantId, scheduleId, runId })
  await recordAudit(ctx, {
    entityType: 'report_schedule',
    entityId: scheduleId,
    action: 'export',
    summary: 'Triggered ad-hoc report run',
    metadata: { runId },
  })
  revalidatePath(`/reports/schedules/${scheduleId}`)
}

export async function updateSchedule(scheduleId: string, formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.schedule')
  if (!ctx.membership) throw new Error('An active tenant membership is required to edit schedules')
  const runAsTenantUserId = ctx.membership.id

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
        runAsTenantUserId,
        runAsRoleId: ctx.activeRoleId ?? null,
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
