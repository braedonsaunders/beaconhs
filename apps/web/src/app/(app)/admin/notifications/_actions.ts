'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { tenantNotificationPolicy, tenantNotificationSettings } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'

export type EscalationStep = { afterDays: number; roleKeys: string[] }

export type CategorySettingInput = {
  category: string
  enabled: boolean
  roleKeys: string[]
  userIds: string[]
  reminderHours: number | null
  channels: string[]
  escalation: EscalationStep[]
}

export type PolicyInput = {
  unifiedDetection: boolean
  digestMode: 'off' | 'daily' | 'weekly'
  digestHourUtc: number
  quietHours: { start: number; end: number } | null
}

const VALID_CHANNELS = ['in_app', 'email', 'push', 'sms']

const clampHours = (h: number | null): number | null =>
  h == null || !Number.isFinite(h) ? null : Math.min(8760, Math.max(1, Math.round(h)))

const cleanEscalation = (steps: EscalationStep[]): EscalationStep[] =>
  steps
    .map((s) => ({
      afterDays: Math.min(365, Math.max(1, Math.round(s.afterDays || 1))),
      roleKeys: [...new Set(s.roleKeys.filter(Boolean))],
    }))
    .filter((s) => s.roleKeys.length > 0)
    .sort((a, b) => a.afterDays - b.afterDays)

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
      const channels = item.channels.filter((c) => VALID_CHANNELS.includes(c))
      const escalation = cleanEscalation(item.escalation)
      await tx
        .insert(tenantNotificationSettings)
        .values({
          tenantId: ctx.tenantId,
          category: item.category,
          enabled: item.enabled,
          roleKeys,
          userIds,
          reminderHours,
          channels,
          escalation,
        })
        .onConflictDoUpdate({
          target: [tenantNotificationSettings.tenantId, tenantNotificationSettings.category],
          set: {
            enabled: item.enabled,
            roleKeys,
            userIds,
            reminderHours,
            channels,
            escalation,
            updatedAt: new Date(),
          },
        })
    }
  })

  revalidatePath('/admin/notifications')
}

/** Tenant-wide routing policy: unified detection, digest, quiet hours. */
export async function saveNotificationPolicy(input: PolicyInput) {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) {
    throw new Error('You do not have permission to manage notification settings.')
  }
  const digestMode = (['off', 'daily', 'weekly'] as const).includes(input.digestMode)
    ? input.digestMode
    : 'off'
  const digestHourUtc = Math.min(23, Math.max(0, Math.round(input.digestHourUtc || 0)))
  const quietHours =
    input.quietHours &&
    Number.isFinite(input.quietHours.start) &&
    Number.isFinite(input.quietHours.end)
      ? {
          start: Math.min(23, Math.max(0, Math.round(input.quietHours.start))),
          end: Math.min(23, Math.max(0, Math.round(input.quietHours.end))),
        }
      : null

  await ctx.db(async (tx) => {
    const [existing] = await tx
      .select({ id: tenantNotificationPolicy.id })
      .from(tenantNotificationPolicy)
      .where(eq(tenantNotificationPolicy.tenantId, ctx.tenantId))
      .limit(1)
    if (existing) {
      await tx
        .update(tenantNotificationPolicy)
        .set({
          unifiedDetection: input.unifiedDetection,
          digestMode,
          digestHourUtc,
          quietHours,
          updatedAt: new Date(),
        })
        .where(eq(tenantNotificationPolicy.id, existing.id))
    } else {
      await tx.insert(tenantNotificationPolicy).values({
        tenantId: ctx.tenantId,
        unifiedDetection: input.unifiedDetection,
        digestMode,
        digestHourUtc,
        quietHours,
      })
    }
  })

  revalidatePath('/admin/notifications')
}
