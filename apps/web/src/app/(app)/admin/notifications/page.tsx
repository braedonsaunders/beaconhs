import { redirect } from 'next/navigation'
import { and, asc, eq } from 'drizzle-orm'
import {
  roles as rolesTable,
  tenantNotificationPolicy,
  tenantNotificationSettings,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { DetailHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
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
      reminderHours: number | null
      channels: string[]
      escalation: { afterDays: number; roleKeys: string[] }[]
    }
  > = {}
  for (const r of settingRows) {
    initial[r.category] = {
      enabled: r.enabled,
      roleKeys: r.roleKeys ?? [],
      userIds: r.userIds ?? [],
      reminderHours: r.reminderHours,
      channels: r.channels ?? [],
      escalation: r.escalation ?? [],
    }
  }

  const policy = {
    unifiedDetection: policyRow?.unifiedDetection ?? false,
    digestMode: (policyRow?.digestMode ?? 'off') as 'off' | 'daily' | 'weekly',
    digestHourUtc: policyRow?.digestHourUtc ?? 7,
    quietHours: policyRow?.quietHours ?? null,
  }

  const members = memberRows
    .map((m) => ({ value: m.userId ?? '', label: m.displayName ?? m.email }))
    .filter((m) => m.value)

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-4">
        <DetailHeader
          back={{ href: '/admin', label: 'Back to admin' }}
          title="Notifications"
          subtitle="Choose who is automatically notified for each kind of alert and how often recurring reminders repeat. These apply tenant-wide; individuals still control their own channels from their inbox settings."
        />
        <NotificationSettingsForm
          categories={NOTIFICATION_CATEGORIES}
          roles={roleRows}
          members={members}
          initial={initial}
          policy={policy}
        />
      </div>
    </PageContainer>
  )
}
