import { getGeneratedTranslations } from '@/i18n/generated.server'
import { redirect } from 'next/navigation'
import { and, asc, count, eq, ilike, inArray, isNull, or } from 'drizzle-orm'
import { notificationGroupMembers, notificationGroups } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { DetailHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { NotificationsSubNav } from '@/components/notifications-sub-nav'
import { parseListParams } from '@/lib/list-params'
import { loadAudienceOptions } from './_options'
import { NotificationGroupsManager, type GroupRow } from './_manager'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_086aa4f81b9be9') }
}

const BASE = '/admin/notifications/groups'

export default async function NotificationGroupsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) redirect('/admin')
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 24,
    allowedSorts: ['name'] as const,
  })

  const data = await ctx.db(async (tx) => {
    const search = params.q
      ? or(
          ilike(notificationGroups.name, `%${params.q}%`),
          ilike(notificationGroups.description, `%${params.q}%`),
        )
      : undefined
    const where = and(
      eq(notificationGroups.tenantId, ctx.tenantId),
      isNull(notificationGroups.deletedAt),
      search,
    )
    const [totalRows, rows] = await Promise.all([
      tx.select({ value: count() }).from(notificationGroups).where(where),
      tx
        .select({
          id: notificationGroups.id,
          name: notificationGroups.name,
          description: notificationGroups.description,
          color: notificationGroups.color,
        })
        .from(notificationGroups)
        .where(where)
        .orderBy(asc(notificationGroups.name), asc(notificationGroups.id))
        .limit(params.perPage)
        .offset((params.page - 1) * params.perPage),
    ])
    const total = totalRows[0]?.value ?? 0
    if (rows.length === 0) return { total, groups: [] as GroupRow[] }
    const members = await tx
      .select({
        groupId: notificationGroupMembers.groupId,
        kind: notificationGroupMembers.kind,
        entityKey: notificationGroupMembers.entityKey,
        mode: notificationGroupMembers.mode,
      })
      .from(notificationGroupMembers)
      .where(
        and(
          eq(notificationGroupMembers.tenantId, ctx.tenantId),
          inArray(
            notificationGroupMembers.groupId,
            rows.map((row) => row.id),
          ),
        ),
      )
      .orderBy(asc(notificationGroupMembers.createdAt), asc(notificationGroupMembers.id))
    const membersByGroup = new Map<string, GroupRow['members']>()
    for (const member of members) {
      const groupMembers = membersByGroup.get(member.groupId) ?? []
      groupMembers.push({ kind: member.kind, entityKey: member.entityKey, mode: member.mode })
      membersByGroup.set(member.groupId, groupMembers)
    }
    return {
      total,
      groups: rows.map((row) => ({ ...row, members: membersByGroup.get(row.id) ?? [] })),
    }
  })

  const { groups, total } = data
  const options = await loadAudienceOptions(
    ctx,
    groups.flatMap((group) => group.members),
  )

  return (
    <PageContainer>
      <div className="space-y-4">
        <DetailHeader
          title={tGenerated('m_086aa4f81b9be9')}
          subtitle={tGenerated('m_0f2b9de7a75008')}
        />
        <NotificationsSubNav active="groups" />
        <NotificationGroupsManager
          groups={groups}
          options={options}
          total={total}
          page={params.page}
          perPage={params.perPage}
          currentParams={sp}
          hasSearch={Boolean(params.q)}
          basePath={BASE}
        />
      </div>
    </PageContainer>
  )
}
