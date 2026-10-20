'use server'

import { activeTenantUsersWhere } from '@beaconhs/db'
import { complianceReminderAvailableAt } from '@beaconhs/compliance'

import { revalidatePath } from 'next/cache'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  complianceDispatches,
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
  // Pause reminder delivery without stopping compliance evaluation.
  remindersEnabled: boolean
  // Reminder delivery schedule (5-field cron, evaluated in scanTimezone).
  reminderCron: string
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
                activeTenantUsersWhere(),
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
  if (!isValidCron(input.reminderCron))
    throw new Error('Enter a valid five-part reminder schedule.')
  if (!isValidTimezone(input.scanTimezone)) throw new Error('Choose a valid compliance timezone.')
  if (typeof input.remindersEnabled !== 'boolean')
    throw new Error('Choose whether reminders are enabled.')

  const digestMode = input.digestMode
  const digestHourUtc = input.digestHourUtc
  const quietHours = input.quietHours
  const remindersEnabled = input.remindersEnabled
  const reminderCron = input.reminderCron.trim()
  const scanTimezone = input.scanTimezone
  const allowed = await loadAllowedRecipients(ctx, items)

  await ctx.db(async (tx) => {
    const [previousPolicy] = await tx
      .select({
        cron: tenantNotificationPolicy.reminderCron,
        timezone: tenantNotificationPolicy.scanTimezone,
      })
      .from(tenantNotificationPolicy)
      .where(eq(tenantNotificationPolicy.tenantId, ctx.tenantId))
      .limit(1)
    for (const item of items) {
      const direct = NOTIFICATION_CATEGORIES.find(
        (category) => category.key === item.category,
      )?.directRecipients
      const roleKeys = uniq(direct ? [] : item.roleKeys).filter((key) => allowed.roleKeys.has(key))
      const userIds = uniq(direct ? [] : item.userIds).filter((id) => allowed.userIds.has(id))
      const groupIds = uniq(direct ? [] : (item.groupIds ?? [])).filter((id) =>
        allowed.groupIds.has(id),
      )
      const channels = item.channels.filter((c) => VALID_CHANNELS.includes(c))
      const escalation = cleanEscalation(direct ? [] : item.escalation, allowed.roleKeys)
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
        remindersEnabled,
        reminderCron,
        scanTimezone,
      })
      .onConflictDoUpdate({
        target: tenantNotificationPolicy.tenantId,
        set: {
          digestMode,
          digestHourUtc,
          quietHours,
          remindersEnabled,
          reminderCron,
          scanTimezone,
          updatedAt: new Date(),
        },
      })
    if (
      !remindersEnabled ||
      items.some((item) => item.category === 'compliance' && !item.enabled)
    ) {
      await tx
        .update(complianceDispatches)
        .set({
          status: 'skipped',
          error: 'Compliance reminders are paused',
          publishLeaseId: null,
          publishClaimedAt: null,
        })
        .where(
          and(
            eq(complianceDispatches.tenantId, ctx.tenantId),
            eq(complianceDispatches.status, 'queued'),
          ),
        )
    } else if (
      (previousPolicy?.cron ?? '0 6 * * *') !== reminderCron ||
      (previousPolicy?.timezone ?? 'UTC') !== scanTimezone
    ) {
      await tx
        .update(complianceDispatches)
        .set({
          publishAvailableAt: complianceReminderAvailableAt(reminderCron, scanTimezone, new Date()),
          publishLeaseId: null,
          publishClaimedAt: null,
        })
        .where(
          and(
            eq(complianceDispatches.tenantId, ctx.tenantId),
            eq(complianceDispatches.status, 'queued'),
          ),
        )
    }
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
      remindersEnabled,
      reminderCron,
      scanTimezone,
    },
  })
  revalidatePath('/admin/notifications')
}
