'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { reportSchedules, reportRuns } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { computeNextRunAt } from '@/lib/report-cadence'
import { enqueueReportRun } from '@beaconhs/jobs'

export async function setActive(scheduleId: string, active: boolean): Promise<void> {
  const ctx = await requireRequestContext()
  await ctx.db(async (tx) => {
    await tx
      .update(reportSchedules)
      .set({ active })
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

  const name = String(formData.get('name') ?? '').trim()
  const cadence = String(formData.get('cadence') ?? '') as 'daily' | 'weekly' | 'monthly'
  const dayOfWeekRaw = String(formData.get('dayOfWeek') ?? '')
  const dayOfMonthRaw = String(formData.get('dayOfMonth') ?? '')
  const hour = Number(formData.get('hour') ?? 7)
  const minute = Number(formData.get('minute') ?? 0)
  const timezone = String(formData.get('timezone') ?? 'America/Toronto').trim() || 'America/Toronto'
  const recipientEmailsRaw = String(formData.get('recipientEmails') ?? '')
  const recipientUserIdsRaw = String(formData.get('recipientUserIds') ?? '')
  const filtersRaw = String(formData.get('filters') ?? '').trim() || '{}'

  if (!name) throw new Error('Name is required')
  if (!['daily', 'weekly', 'monthly'].includes(cadence)) throw new Error('Invalid cadence')

  const dayOfWeek = cadence === 'weekly' ? Number(dayOfWeekRaw || 1) : null
  const dayOfMonth = cadence === 'monthly' ? Number(dayOfMonthRaw || 1) : null

  const recipientEmails = recipientEmailsRaw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
  const recipientUserIds = recipientUserIdsRaw
    .split(/[\n,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  let filters: Record<string, unknown>
  try {
    filters = JSON.parse(filtersRaw)
    if (typeof filters !== 'object' || filters === null || Array.isArray(filters)) {
      throw new Error('not an object')
    }
  } catch (err) {
    throw new Error(`Invalid filters JSON: ${err instanceof Error ? err.message : String(err)}`)
  }

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
    after: { name, cadence, dayOfWeek, dayOfMonth, hour, minute, timezone, recipientEmails, recipientUserIds },
  })

  revalidatePath(`/reports/schedules/${scheduleId}`)
  revalidatePath('/reports')
}

export async function deleteSchedule(scheduleId: string): Promise<void> {
  const ctx = await requireRequestContext()
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
