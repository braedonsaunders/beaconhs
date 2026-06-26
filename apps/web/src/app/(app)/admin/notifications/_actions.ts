'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  notificationGroups,
  roles,
  tenantNotificationPolicy,
  tenantNotificationSettings,
  tenantUsers,
} from '@beaconhs/db/schema'
import { can, type RequestContext } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { NOTIFICATION_CATEGORIES } from './_catalog'
import { DEFAULT_SCAN_CRON, DEFAULT_SCAN_TZ, isValidCron, isValidTimezone } from './_schedule'

export type EscalationStep = { afterDays: number; roleKeys: string[] }

export type CategorySettingInput = {
  category: string
  enabled: boolean
  roleKeys: string[]
  userIds: string[]
  groupIds: string[]
  channels: string[]
  escalation: EscalationStep[]
}

export type PolicyInput = {
  digestMode: 'off' | 'daily' | 'weekly'
  digestHourUtc: number
  quietHours: { start: number; end: number } | null
  // Compliance detection schedule (5-field cron, evaluated in scanTimezone).
  scanCron: string
  scanTimezone: string
}

const VALID_CHANNELS = ['in_app', 'email', 'push', 'sms']
const VALID_CATEGORIES = new Set(NOTIFICATION_CATEGORIES.map((category) => category.key))

function uniq(input: string[]): string[] {
  return [...new Set(input.map((value) => value.trim()).filter(Boolean))]
}

const cleanEscalation = (
  steps: EscalationStep[],
  allowedRoleKeys?: ReadonlySet<string>,
): EscalationStep[] =>
  steps
    .map((s) => ({
      afterDays: Math.min(365, Math.max(1, Math.round(s.afterDays || 1))),
      roleKeys: uniq(s.roleKeys).filter((key) => !allowedRoleKeys || allowedRoleKeys.has(key)),
    }))
    .filter((s) => s.roleKeys.length > 0)
    .sort((a, b) => a.afterDays - b.afterDays)

async function loadAllowedRecipients(ctx: RequestContext, items: CategorySettingInput[]) {
  const requestedRoleKeys = uniq(
    items.flatMap((item) => [
      ...item.roleKeys,
      ...(item.escalation ?? []).flatMap((step) => step.roleKeys),
    ]),
  )
  const requestedUserIds = uniq(items.flatMap((item) => item.userIds))
  const requestedGroupIds = uniq(items.flatMap((item) => item.groupIds ?? []))

  return ctx.db(async (tx) => {
    const roleRows =
      requestedRoleKeys.length > 0
        ? await tx
            .select({ key: roles.key })
            .from(roles)
            .where(and(eq(roles.tenantId, ctx.tenantId), inArray(roles.key, requestedRoleKeys)))
        : []
    const userRows =
      requestedUserIds.length > 0
        ? await tx
            .select({ userId: tenantUsers.userId })
            .from(tenantUsers)
            .where(
              and(
                eq(tenantUsers.tenantId, ctx.tenantId),
                eq(tenantUsers.status, 'active'),
                inArray(tenantUsers.userId, requestedUserIds),
              ),
            )
        : []
    const groupRows =
      requestedGroupIds.length > 0
        ? await tx
            .select({ id: notificationGroups.id })
            .from(notificationGroups)
            .where(
              and(
                eq(notificationGroups.tenantId, ctx.tenantId),
                isNull(notificationGroups.deletedAt),
                inArray(notificationGroups.id, requestedGroupIds),
              ),
            )
        : []
    return {
      roleKeys: new Set(roleRows.map((row) => row.key)),
      userIds: new Set(userRows.map((row) => row.userId)),
      groupIds: new Set(groupRows.map((row) => row.id)),
    }
  })
}

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
  if (items.some((item) => !VALID_CATEGORIES.has(item.category))) {
    throw new Error('One or more notification categories are invalid.')
  }

  const allowed = await loadAllowedRecipients(ctx, items)

  await ctx.db(async (tx) => {
    for (const item of items) {
      const roleKeys = uniq(item.roleKeys).filter((key) => allowed.roleKeys.has(key))
      const userIds = uniq(item.userIds).filter((id) => allowed.userIds.has(id))
      const groupIds = uniq(item.groupIds ?? []).filter((id) => allowed.groupIds.has(id))
      const channels = item.channels.filter((c) => VALID_CHANNELS.includes(c))
      const escalation = cleanEscalation(item.escalation, allowed.roleKeys)
      await tx
        .insert(tenantNotificationSettings)
        .values({
          tenantId: ctx.tenantId,
          category: item.category,
          enabled: item.enabled,
          roleKeys,
          userIds,
          groupIds,
          channels,
          escalation,
        })
        .onConflictDoUpdate({
          target: [tenantNotificationSettings.tenantId, tenantNotificationSettings.category],
          set: {
            enabled: item.enabled,
            roleKeys,
            userIds,
            groupIds,
            channels,
            escalation,
            updatedAt: new Date(),
          },
        })
    }
  })

  await recordAudit(ctx, {
    entityType: 'tenant',
    entityId: ctx.tenantId,
    action: 'update',
    summary: 'Updated notification routing rules',
    metadata: { categories: items.map((item) => item.category) },
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
  // Reject a malformed cron / timezone rather than silently scheduling something
  // the worker can't parse — fall back to the safe legacy default.
  const scanCron = isValidCron(input.scanCron) ? input.scanCron.trim() : DEFAULT_SCAN_CRON
  const scanTimezone = isValidTimezone(input.scanTimezone) ? input.scanTimezone : DEFAULT_SCAN_TZ

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
          digestMode,
          digestHourUtc,
          quietHours,
          scanCron,
          scanTimezone,
          updatedAt: new Date(),
        })
        .where(eq(tenantNotificationPolicy.id, existing.id))
    } else {
      await tx.insert(tenantNotificationPolicy).values({
        tenantId: ctx.tenantId,
        digestMode,
        digestHourUtc,
        quietHours,
        scanCron,
        scanTimezone,
      })
    }
  })

  await recordAudit(ctx, {
    entityType: 'tenant',
    entityId: ctx.tenantId,
    action: 'update',
    summary: 'Updated notification routing policy',
    metadata: { digestMode, digestHourUtc, quietHours, scanCron, scanTimezone },
  })
  revalidatePath('/admin/notifications')
}
