'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { reportSchedules } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { prepareScheduleMutation } from '../_mutation'

export async function createSchedule(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.schedule')
  if (!ctx.membership)
    throw new Error('An active tenant membership is required to schedule reports')
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

  const [row] = await ctx.db(async (tx) => {
    return tx
      .insert(reportSchedules)
      .values({
        tenantId: ctx.tenantId,
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
        active: true,
      })
      .returning({ id: reportSchedules.id })
  })

  if (!row) throw new Error('Failed to create report schedule')

  await recordAudit(ctx, {
    entityType: 'report_schedule',
    entityId: row.id,
    action: 'create',
    summary: `Created report schedule "${name}" (${cadence})`,
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

  revalidatePath('/reports')
  redirect(`/reports/schedules/${row.id}`)
}
