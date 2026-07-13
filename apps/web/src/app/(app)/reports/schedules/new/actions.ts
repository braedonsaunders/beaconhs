'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { reportSchedules } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { computeNextRunAt } from '@beaconhs/reports'
import { loadDefinitionById } from '../../_definitions'
import { parseScheduleForm } from '../_parse'

export async function createSchedule(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.schedule')
  if (!ctx.membership)
    throw new Error('An active tenant membership is required to schedule reports')
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

  if (row) {
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
  }

  revalidatePath('/reports')
  if (row) redirect(`/reports/schedules/${row.id}`)
  redirect('/reports')
}
