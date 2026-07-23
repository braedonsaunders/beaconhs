'use server'

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { reportDefinitions, reportSchedules } from '@beaconhs/db/schema'
import { enqueueReportRun } from '@beaconhs/jobs'
import {
  assertBoundedReportFilters,
  assertReportRecipientLimit,
  computeNextRunAt,
  type ParsedReportScheduleForm,
} from '@beaconhs/reports'
import {
  claimBeaconReportRun,
  loadBeaconReportCatalog,
  normalizeReportRuntimeFilters,
  validateBeaconReportRuntimeFilters,
} from '@beaconhs/reports/server'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

export async function saveSchedule(
  id: string | null,
  value: ParsedReportScheduleForm,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireRequestContext()
    assertCan(ctx, 'reports.schedule')
    if (!ctx.membership) throw new Error('An active tenant membership is required.')
    assertBoundedReportFilters(value.filters)
    assertReportRecipientLimit(value.recipientUserIds, value.recipientEmails)
    const nextRunAt = computeNextRunAt(value)
    const scheduleId = await ctx.db(async (tx) => {
      const [definition] = await tx
        .select({ id: reportDefinitions.id, query: reportDefinitions.query })
        .from(reportDefinitions)
        .where(
          and(
            eq(reportDefinitions.tenantId, ctx.tenantId!),
            eq(reportDefinitions.id, value.definitionId),
          ),
        )
        .limit(1)
      if (!definition) throw new Error('Choose an available report.')
      const catalog = await loadBeaconReportCatalog(tx)
      validateBeaconReportRuntimeFilters(
        ctx.tenantId!,
        definition.query,
        catalog,
        normalizeReportRuntimeFilters(value.filters),
      )
      const fields = {
        definitionId: value.definitionId,
        name: value.name,
        cadence: value.cadence,
        repeatEvery: value.repeatEvery,
        dayOfWeek: value.dayOfWeek ?? null,
        dayOfMonth: value.dayOfMonth ?? null,
        weekOfMonth: value.weekOfMonth ?? null,
        hour: value.hour,
        minute: value.minute,
        timezone: value.timezone,
        startsOn: value.startsOn ?? null,
        endsOn: value.endsOn ?? null,
        recipientUserIds: value.recipientUserIds,
        recipientEmails: value.recipientEmails,
        filters: value.filters,
        emailSubject: value.emailSubject ?? null,
        emailMessage: value.emailMessage ?? null,
        runAsTenantUserId: ctx.membership!.id,
        runAsRoleId: ctx.activeRoleId ?? null,
        nextRunAt,
        active: nextRunAt != null,
        updatedAt: new Date(),
      }
      if (id) {
        const [updated] = await tx
          .update(reportSchedules)
          .set(fields)
          .where(and(eq(reportSchedules.tenantId, ctx.tenantId!), eq(reportSchedules.id, id)))
          .returning({ id: reportSchedules.id })
        if (!updated) throw new Error('Schedule not found.')
        return updated.id
      }
      const [created] = await tx
        .insert(reportSchedules)
        .values({ tenantId: ctx.tenantId!, ...fields })
        .returning({ id: reportSchedules.id })
      if (!created) throw new Error('Could not create the schedule.')
      return created.id
    })
    await recordAudit(ctx, {
      entityType: 'report_schedule',
      entityId: scheduleId,
      action: id ? 'update' : 'create',
      summary: `${id ? 'Updated' : 'Created'} report schedule "${value.name}"`,
    })
    revalidatePath('/reports/schedules')
    revalidatePath(`/reports/schedules/${scheduleId}`)
    return { ok: true, id: scheduleId }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }
}

export async function setScheduleActive(id: string, active: boolean): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.schedule')
  const schedule = await ctx.db(async (tx) => {
    const [current] = await tx
      .select()
      .from(reportSchedules)
      .where(and(eq(reportSchedules.tenantId, ctx.tenantId!), eq(reportSchedules.id, id)))
      .limit(1)
    if (!current) throw new Error('Schedule not found.')
    const nextRunAt = active ? computeNextRunAt(current) : current.nextRunAt
    if (active && !nextRunAt) throw new Error('This schedule has ended.')
    await tx
      .update(reportSchedules)
      .set({ active, nextRunAt, updatedAt: new Date() })
      .where(and(eq(reportSchedules.tenantId, ctx.tenantId!), eq(reportSchedules.id, id)))
    return current
  })
  await recordAudit(ctx, {
    entityType: 'report_schedule',
    entityId: id,
    action: active ? 'publish' : 'archive',
    summary: `${active ? 'Activated' : 'Paused'} report schedule "${schedule.name}"`,
  })
  revalidatePath('/reports/schedules')
}

export async function runScheduleNow(id: string): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.schedule')
  if (!ctx.membership) throw new Error('An active tenant membership is required.')
  const runId = await ctx.db(async (tx) => {
    const run = await claimBeaconReportRun(tx, {
      scheduleId: id,
      scheduledFor: new Date(),
      trigger: 'manual',
    })
    return run.id
  })
  await enqueueReportRun({ tenantId: ctx.tenantId!, scheduleId: id, runId })
  await recordAudit(ctx, {
    entityType: 'report_schedule',
    entityId: id,
    action: 'export',
    summary: 'Triggered report run',
    metadata: { runId },
  })
  revalidatePath(`/reports/schedules/${id}`)
}
