import { redirect } from 'next/navigation'
import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  notificationGroups,
  roles as rolesTable,
  tenantNotificationPolicy,
  tenantNotificationSettings,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { DetailHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { getEmailPolicyMode, getTenantEmailSettings } from '@/lib/email-config'
import { getSmsPolicyMode, getTenantSmsSettings } from '@/lib/sms-config'
import { PageContainer } from '@/components/page-layout'
import { NotificationsSubNav } from '@/components/notifications-sub-nav'
import { NOTIFICATION_CATEGORIES } from './_catalog'
import { NotificationSettingsForm } from './_form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Notifications' }

export default async function NotificationSettingsPage() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) redirect('/admin')

  const { roleRows, memberRows } = await ctx.db(async (tx) => {
    const roleRows = await tx
      .select({ key: rolesTable.key, name: rolesTable.name })
      .from(rolesTable)
      .where(eq(rolesTable.tenantId, ctx.tenantId))
      .orderBy(asc(rolesTable.name))
    const memberRows = await tx
      .select({
        userId: tenantUsers.userId,
        displayName: tenantUsers.displayName,
        email: users.email,
      })
      .from(tenantUsers)
      .innerJoin(users, eq(users.id, tenantUsers.userId))
      .where(and(eq(tenantUsers.tenantId, ctx.tenantId), eq(tenantUsers.status, 'active')))
      .orderBy(asc(tenantUsers.displayName))
    return { roleRows, memberRows }
  })

  // Read separately + guarded: the settings/policy tables are additive, so the
  // page still renders with defaults during the window before their DDL applies.
  let settingRows: (typeof tenantNotificationSettings.$inferSelect)[] = []
  let policyRow: typeof tenantNotificationPolicy.$inferSelect | null = null
  try {
    settingRows = await ctx.db((tx) =>
      tx
        .select()
        .from(tenantNotificationSettings)
        .where(eq(tenantNotificationSettings.tenantId, ctx.tenantId)),
    )
    const [p] = await ctx.db((tx) =>
      tx
        .select()
        .from(tenantNotificationPolicy)
        .where(eq(tenantNotificationPolicy.tenantId, ctx.tenantId))
        .limit(1),
    )
    policyRow = p ?? null
  } catch {
    settingRows = []
  }

  const initial: Record<
    string,
    {
      enabled: boolean
      roleKeys: string[]
      userIds: string[]
      groupIds: string[]
      channels: string[]
      escalation: { afterDays: number; roleKeys: string[] }[]
    }
  > = {}
  for (const r of settingRows) {
    initial[r.category] = {
      enabled: r.enabled,
      roleKeys: r.roleKeys ?? [],
      userIds: r.userIds ?? [],
      groupIds: r.groupIds ?? [],
      channels: r.channels ?? [],
      escalation: r.escalation ?? [],
    }
  }

  // Reusable notification groups, selectable per category. Guarded for the
  // pre-migration window.
  let groupRows: { id: string; name: string }[] = []
  try {
    groupRows = await ctx.db((tx) =>
      tx
        .select({ id: notificationGroups.id, name: notificationGroups.name })
        .from(notificationGroups)
        .where(
          and(eq(notificationGroups.tenantId, ctx.tenantId), isNull(notificationGroups.deletedAt)),
        )
        .orderBy(asc(notificationGroups.name)),
    )
  } catch {
    groupRows = []
  }
  const groups = groupRows.map((g) => ({ value: g.id, label: g.name }))

  const policy = {
    digestMode: (policyRow?.digestMode ?? 'off') as 'off' | 'daily' | 'weekly',
    digestHourUtc: policyRow?.digestHourUtc ?? 7,
    quietHours: policyRow?.quietHours ?? null,
    scanCron: policyRow?.scanCron ?? '0 6 * * *',
    scanTimezone: policyRow?.scanTimezone ?? 'UTC',
  }

  const members = memberRows
    .map((m) => ({ value: m.userId ?? '', label: m.displayName ?? m.email }))
    .filter((m) => m.value)

  // Channel availability — surfaced so admins know which channels actually
  // deliver before they enable them. Guarded; defaults to "not set up".
  let emailConfigured = false
  let smsConfigured = false
  try {
    const [emailMode, tEmail, smsMode, tSms] = await Promise.all([
      getEmailPolicyMode(),
      getTenantEmailSettings(ctx),
      getSmsPolicyMode(),
      getTenantSmsSettings(ctx),
    ])
    emailConfigured =
      emailMode !== 'disabled' &&
      (emailMode === 'global_only' || (tEmail.enabled && !!tEmail.fromEmail))
    smsConfigured =
      smsMode !== 'disabled' && (smsMode === 'global_only' || (tSms.enabled && !!tSms.fromNumber))
  } catch {
    // platform/tenant settings unavailable — leave both false.
  }

  return (
    <PageContainer>
      <div className="space-y-4">
        <DetailHeader
          title="Notifications"
          subtitle="Choose who is notified for each kind of alert, through which channels, and how it escalates. These apply tenant-wide; individuals still control their own channels from their inbox settings."
        />
        <NotificationsSubNav active="rules" />
        <NotificationSettingsForm
          categories={NOTIFICATION_CATEGORIES}
          roles={roleRows}
          members={members}
          groups={groups}
          initial={initial}
          policy={policy}
          emailConfigured={emailConfigured}
          smsConfigured={smsConfigured}
        />
      </div>
    </PageContainer>
  )
}
