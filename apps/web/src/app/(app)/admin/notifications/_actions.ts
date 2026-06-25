'use server'

import { revalidatePath } from 'next/cache'
import { tenantNotificationSettings } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'

export type CategorySettingInput = {
  category: string
  enabled: boolean
  roleKeys: string[]
  userIds: string[]
  reminderHours: number | null
}

const clampHours = (h: number | null): number | null =>
  h == null || !Number.isFinite(h) ? null : Math.min(8760, Math.max(1, Math.round(h)))

/**
 * Upsert one row per category for the active tenant. A row always exists once
 * saved, so the dispatcher/scans read the tenant's explicit choice rather than
 * the built-in defaults.
 */
export async function saveNotificationSettings(items: CategorySettingInput[]) {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) {
    throw new Error('You do not have permission to manage notification settings.')
  }

  await ctx.db(async (tx) => {
    for (const item of items) {
      const roleKeys = [...new Set(item.roleKeys.filter(Boolean))]
      const userIds = [...new Set(item.userIds.filter(Boolean))]
      const reminderHours = clampHours(item.reminderHours)
      await tx
        .insert(tenantNotificationSettings)
        .values({
          tenantId: ctx.tenantId,
          category: item.category,
          enabled: item.enabled,
          roleKeys,
          userIds,
          reminderHours,
        })
        .onConflictDoUpdate({
          target: [tenantNotificationSettings.tenantId, tenantNotificationSettings.category],
          set: { enabled: item.enabled, roleKeys, userIds, reminderHours, updatedAt: new Date() },
        })
    }
  })

  revalidatePath('/admin/notifications')
}
