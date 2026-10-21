'use server'
import { eq } from 'drizzle-orm'
import { tenantNotificationPolicy } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { revalidatePath } from 'next/cache'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import { isValidCron } from '@/lib/reminder-schedule'

export async function saveEquipmentReminderSettings(input: { enabled: boolean; cron: string }) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  if (
    typeof input.enabled !== 'boolean' ||
    typeof input.cron !== 'string' ||
    !isValidCron(input.cron)
  )
    return { ok: false, error: 'Enter a valid five-part reminder schedule.' } as const
  const cron = input.cron.trim()
  await ctx.db(async (tx) => {
    const [before] = await tx
      .select()
      .from(tenantNotificationPolicy)
      .where(eq(tenantNotificationPolicy.tenantId, ctx.tenantId))
      .limit(1)
      .for('update')
    await tx
      .insert(tenantNotificationPolicy)
      .values({
        tenantId: ctx.tenantId,
        equipmentRemindersEnabled: input.enabled,
        equipmentReminderCron: cron,
      })
      .onConflictDoUpdate({
        target: tenantNotificationPolicy.tenantId,
        set: {
          equipmentRemindersEnabled: input.enabled,
          equipmentReminderCron: cron,
          updatedAt: new Date(),
        },
      })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'tenant',
      entityId: ctx.tenantId,
      action: 'update',
      summary: 'Updated equipment maintenance reminder settings',
      before: {
        enabled: before?.equipmentRemindersEnabled ?? true,
        cron: before?.equipmentReminderCron ?? '0 6 * * *',
      },
      after: { enabled: input.enabled, cron },
    })
  })
  revalidatePath('/equipment/maintenance/settings')
  revalidatePath('/equipment/maintenance')
  return { ok: true } as const
}
