'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { reportDefinitions, reportSchedules } from '@beaconhs/db/schema'
import { db, withSuperAdmin } from '@beaconhs/db'
import { eq } from 'drizzle-orm'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { computeNextRunAt } from '@/lib/report-cadence'

const CADENCES = ['daily', 'weekly', 'monthly'] as const
type Cadence = (typeof CADENCES)[number]

export async function createSchedule(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()

  const definitionId = String(formData.get('definitionId') ?? '').trim()
  const name = String(formData.get('name') ?? '').trim()
  const cadence = String(formData.get('cadence') ?? '') as Cadence
  const dayOfWeekRaw = String(formData.get('dayOfWeek') ?? '')
  const dayOfMonthRaw = String(formData.get('dayOfMonth') ?? '')
  const hour = Number(formData.get('hour') ?? 7)
  const minute = Number(formData.get('minute') ?? 0)
  const timezone = String(formData.get('timezone') ?? 'America/Toronto').trim() || 'America/Toronto'
  const recipientEmailsRaw = String(formData.get('recipientEmails') ?? '')
  const recipientUserIdsRaw = String(formData.get('recipientUserIds') ?? '')
  const filtersRaw = String(formData.get('filters') ?? '').trim()

  if (!definitionId) throw new Error('Report definition is required')
  if (!name) throw new Error('Name is required')
  if (!CADENCES.includes(cadence)) throw new Error('Invalid cadence')
  if (Number.isNaN(hour) || hour < 0 || hour > 23) throw new Error('Invalid hour')
  if (Number.isNaN(minute) || minute < 0 || minute > 59) throw new Error('Invalid minute')
  const dayOfWeek = cadence === 'weekly' ? Number(dayOfWeekRaw || 1) : null
  const dayOfMonth = cadence === 'monthly' ? Number(dayOfMonthRaw || 1) : null
  if (cadence === 'weekly' && (dayOfWeek === null || dayOfWeek < 0 || dayOfWeek > 6))
    throw new Error('Invalid day-of-week')
  if (cadence === 'monthly' && (dayOfMonth === null || dayOfMonth < 1 || dayOfMonth > 31))
    throw new Error('Invalid day-of-month')

  // Validate the definition exists (cross-tenant).
  const def = await withSuperAdmin(db, async (tx) => {
    const [d] = await tx
      .select()
      .from(reportDefinitions)
      .where(eq(reportDefinitions.id, definitionId))
      .limit(1)
    return d ?? null
  })
  if (!def) throw new Error('Unknown report definition')

  const recipientEmails = recipientEmailsRaw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
  const recipientUserIds = recipientUserIdsRaw
    .split(/[\n,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  let filters: Record<string, unknown> = {}
  if (filtersRaw) {
    try {
      filters = JSON.parse(filtersRaw)
      if (typeof filters !== 'object' || Array.isArray(filters) || filters === null) {
        throw new Error('not an object')
      }
    } catch (err) {
      throw new Error(`Invalid filters JSON: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

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
