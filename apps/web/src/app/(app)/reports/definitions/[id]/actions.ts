'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, eq, isNull, or } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { reportDefinitions, reportSchedules } from '@beaconhs/db/schema'
import { enqueueReportRun } from '@beaconhs/jobs'
import { requireRequestContext } from '@/lib/auth'
import { computeNextRunAt } from '@/lib/report-cadence'

/**
 * Run-once: build (or reuse) a hidden, single-recipient schedule pointed at
 * the definition, then enqueue an immediate report run against it. We need
 * a schedule row because `report_runs` has a NOT-NULL FK to scheduleId — the
 * worker reads filters/recipients off it.
 */
export async function runOnceFromDefinition(definitionId: string): Promise<void> {
  const ctx = await requireRequestContext()

  // Make sure the definition is visible to this tenant (built-in or owned).
  const def = await withSuperAdmin(db, async (tx) => {
    const [d] = await tx
      .select()
      .from(reportDefinitions)
      .where(
        and(
          eq(reportDefinitions.id, definitionId),
          or(
            isNull(reportDefinitions.tenantId),
            eq(reportDefinitions.tenantId, ctx.tenantId!),
          ),
        ),
      )
      .limit(1)
    return d ?? null
  })
  if (!def) throw new Error('Definition not visible to this tenant')

  // Reuse an existing one-shot schedule if we already made one for this def.
  const oneShotName = `One-shot — ${def.name}`
  const scheduleId = await ctx.db(async (tx) => {
    const [existing] = await tx
      .select({ id: reportSchedules.id })
      .from(reportSchedules)
      .where(
        and(
          eq(reportSchedules.tenantId, ctx.tenantId!),
          eq(reportSchedules.definitionId, definitionId),
          eq(reportSchedules.name, oneShotName),
        ),
      )
      .limit(1)
    if (existing) return existing.id

    // Otherwise create one. It's marked paused (active=false) so the
    // periodic scheduler never picks it; only this run-now action queues it.
    const nextRunAt = computeNextRunAt({
      cadence: 'daily',
      dayOfWeek: null,
      dayOfMonth: null,
      hour: 8,
      minute: 0,
      timezone: 'America/Toronto',
    })
    const [row] = await tx
      .insert(reportSchedules)
      .values({
        tenantId: ctx.tenantId!,
        definitionId,
        name: oneShotName,
        cadence: 'daily',
        hour: 8,
        minute: 0,
        timezone: 'America/Toronto',
        recipientUserIds: [ctx.userId!],
        recipientEmails: [],
        filters: {},
        nextRunAt,
        active: false,
      })
      .returning({ id: reportSchedules.id })
    return row!.id
  })

  await enqueueReportRun({ tenantId: ctx.tenantId!, scheduleId })

  revalidatePath(`/reports/definitions/${definitionId}`)
  revalidatePath(`/reports/schedules/${scheduleId}`)
  redirect(`/reports/schedules/${scheduleId}`)
}

/** Delete a custom definition. Built-ins cannot be deleted. */
export async function deleteDefinition(definitionId: string): Promise<void> {
  const ctx = await requireRequestContext()
  await withSuperAdmin(db, async (tx) => {
    const [d] = await tx
      .select()
      .from(reportDefinitions)
      .where(eq(reportDefinitions.id, definitionId))
      .limit(1)
    if (!d) throw new Error('Definition not found')
    if (d.kind !== 'custom') throw new Error('Built-in definitions cannot be deleted')
    if (d.tenantId !== ctx.tenantId) {
      throw new Error('Cannot delete a definition owned by another tenant')
    }
    // FK from report_schedules.definitionId is ON DELETE RESTRICT —
    // the user must first delete any subscriptions.
    const subs = await tx
      .select({ id: reportSchedules.id })
      .from(reportSchedules)
      .where(eq(reportSchedules.definitionId, definitionId))
      .limit(1)
    if (subs.length > 0) {
      throw new Error(
        'Delete the schedules pointing at this report first, then try again.',
      )
    }
    await tx.delete(reportDefinitions).where(eq(reportDefinitions.id, definitionId))
  })

  // Set a tenant-id setting for the post-delete redirect path. Actually we
  // just need to bust caches and bounce.
  revalidatePath('/reports')
  revalidatePath('/reports/definitions')
  redirect('/reports/definitions' as any)
}

