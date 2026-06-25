import { redirect } from 'next/navigation'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { notificationGroupMembers, notificationGroups } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { DetailHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { loadAudienceOptions } from './_options'
import { NotificationGroupsManager, type GroupRow } from './_manager'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Notification groups' }

export default async function NotificationGroupsPage() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) redirect('/admin')

  const options = await loadAudienceOptions(ctx)

  let groups: GroupRow[] = []
  try {
    groups = await ctx.db(async (tx) => {
      const rows = await tx
        .select({
          id: notificationGroups.id,
          name: notificationGroups.name,
          description: notificationGroups.description,
          color: notificationGroups.color,
        })
        .from(notificationGroups)
        .where(
          and(eq(notificationGroups.tenantId, ctx.tenantId), isNull(notificationGroups.deletedAt)),
        )
        .orderBy(asc(notificationGroups.name))
      if (rows.length === 0) return []
      const members = await tx
        .select({
          groupId: notificationGroupMembers.groupId,
          kind: notificationGroupMembers.kind,
          entityKey: notificationGroupMembers.entityKey,
          mode: notificationGroupMembers.mode,
        })
        .from(notificationGroupMembers)
        .where(
          inArray(
            notificationGroupMembers.groupId,
            rows.map((r) => r.id),
          ),
        )
      return rows.map((r) => ({
        ...r,
        members: members
          .filter((m) => m.groupId === r.id)
          .map((m) => ({ kind: m.kind, entityKey: m.entityKey, mode: m.mode })),
      }))
    })
  } catch {
    // Table not yet migrated — render the empty manager so the page still works.
    groups = []
  }

  return (
    <PageContainer>
      <div className="max-w-4xl space-y-4">
        <DetailHeader
          back={{ href: '/admin/notifications', label: 'Back to notifications' }}
          title="Notification groups"
          subtitle="Reusable audiences you can target from any alert — incidents, corrective actions, compliance, Flows, and record shares. A group is a union of roles, departments, sites, crews, people groups, and named individuals (with optional exclusions)."
        />
        <NotificationGroupsManager groups={groups} options={options} />
      </div>
    </PageContainer>
  )
}
