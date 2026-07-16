'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  personGroups,
  roles,
  tenantNotificationPolicy,
  tenantNotificationSettings,
  tenantUsers,
} from '@beaconhs/db/schema'
import { can, type RequestContext } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { NOTIFICATION_CATEGORIES } from './_catalog'
import { isValidCron, isValidTimezone } from './_schedule'

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
  // Compliance detection master switch. When false the worker skips the tenant
  // entirely and the schedule below is inert.
  scanEnabled: boolean
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
            .select({ id: personGroups.id })
            .from(personGroups)
            .where(
              and(
                eq(personGroups.tenantId, ctx.tenantId),
                isNull(personGroups.deletedAt),
                inArray(personGroups.id, requestedGroupIds),
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
export async function saveNotificationConfiguration(
  items: CategorySettingInput[],
  input: PolicyInput,
) {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) {
    throw new Error('You do not have permission to manage notification settings.')
  }
  if (items.some((item) => !VALID_CATEGORIES.has(item.category))) {
    throw new Error('One or more notification categories are invalid.')
  }
  if (!(['off', 'daily', 'weekly'] as const).includes(input.digestMode)) {
    throw new Error('Choose a valid digest schedule.')
  }
  if (
    !Number.isInteger(input.digestHourUtc) ||
    input.digestHourUtc < 0 ||
    input.digestHourUtc > 23
  ) {
    throw new Error('Digest hour must be a whole UTC hour from 0 to 23.')
  }
  if (
    input.quietHours &&
    (!Number.isInteger(input.quietHours.start) ||
      input.quietHours.start < 0 ||
      input.quietHours.start > 23 ||
      !Number.isInteger(input.quietHours.end) ||
      input.quietHours.end < 0 ||
      input.quietHours.end > 23)
  ) {
    throw new Error('Quiet hours must use whole UTC hours from 0 to 23.')
  }
  if (!isValidCron(input.scanCron)) throw new Error('Enter a valid five-part scan schedule.')
  if (!isValidTimezone(input.scanTimezone)) throw new Error('Choose a valid scan timezone.')

  const digestMode = input.digestMode
  const digestHourUtc = input.digestHourUtc
  const quietHours = input.quietHours
  const scanEnabled = input.scanEnabled
  const scanCron = input.scanCron.trim()
  const scanTimezone = input.scanTimezone
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

    await tx
      .insert(tenantNotificationPolicy)
      .values({
        tenantId: ctx.tenantId,
        digestMode,
        digestHourUtc,
        quietHours,
        scanEnabled,
        scanCron,
        scanTimezone,
      })
      .onConflictDoUpdate({
        target: tenantNotificationPolicy.tenantId,
        set: {
          digestMode,
          digestHourUtc,
          quietHours,
          scanEnabled,
          scanCron,
          scanTimezone,
          updatedAt: new Date(),
        },
      })
  })

  await recordAudit(ctx, {
    entityType: 'tenant',
    entityId: ctx.tenantId,
    action: 'update',
    summary: 'Updated notification routing configuration',
    metadata: {
      categories: items.map((item) => item.category),
      digestMode,
      digestHourUtc,
      quietHours,
      scanEnabled,
      scanCron,
      scanTimezone,
    },
  })
  revalidatePath('/admin/notifications')
}
