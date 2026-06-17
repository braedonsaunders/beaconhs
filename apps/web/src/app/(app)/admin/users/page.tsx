import Link from 'next/link'
import { redirect } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import { Badge, Button, DetailHeader, EmptyState, cn } from '@beaconhs/ui'
import { roleAssignments, roles, tenantUsers, user } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { SortTh } from '@/components/sortable-th'
import { ListCard, MobileCardList } from '@/components/list-card'
import { mergeHref, parseListParams, pickString } from '@/lib/list-params'

export const metadata = { title: 'Users & roles' }
export const dynamic = 'force-dynamic'

const SORTS = ['name', 'email', 'status', 'joined'] as const
const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'invited', label: 'Invited' },
  { value: 'suspended', label: 'Suspended' },
] as const

type MemberRow = {
  membershipId: string
  name: string
  email: string
  displayName: string | null
  status: 'active' | 'invited' | 'suspended'
  isSuperAdmin: boolean
  joinedAt: Date | null
  roleNames: string[]
}

function statusVariant(status: MemberRow['status']) {
  return status === 'active' ? 'success' : status === 'invited' ? 'secondary' : 'destructive'
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.users.manage')) redirect('/admin')

  const sp = await searchParams
  const { sort, dir } = parseListParams(sp, { sort: 'name', dir: 'asc', allowedSorts: SORTS })
  const statusFilter = pickString(sp.status) ?? 'all'

  const rows = await ctx.db(async (tx) => {
    const memberRows = await tx
      .select({ membership: tenantUsers, account: user })
      .from(tenantUsers)
      .innerJoin(user, eq(user.id, tenantUsers.userId))
      .orderBy(asc(user.name))
    const allAssignments = await tx
      .select({ tenantUserId: roleAssignments.tenantUserId, roleName: roles.name })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    return memberRows.map<MemberRow>((m) => ({
      membershipId: m.membership.id,
      name: m.account.name,
      email: m.account.email,
      displayName: m.membership.displayName,
      status: m.membership.status,
      isSuperAdmin: m.account.isSuperAdmin,
      joinedAt: m.membership.joinedAt,
      roleNames: allAssignments
        .filter((a) => a.tenantUserId === m.membership.id)
        .map((a) => a.roleName),
    }))
  })

  const filtered = rows.filter((r) => statusFilter === 'all' || r.status === statusFilter)
  const sorted = [...filtered].sort((a, b) => {
    const mult = dir === 'asc' ? 1 : -1
    switch (sort) {
      case 'email':
        return a.email.localeCompare(b.email) * mult
      case 'status':
        return a.status.localeCompare(b.status) * mult
      case 'joined':
        return ((a.joinedAt?.getTime() ?? 0) - (b.joinedAt?.getTime() ?? 0)) * mult
      default:
        return (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name) * mult
    }
  })

  const basePath = '/admin/users'
  const sortProps = { basePath, currentParams: sp, sort, dir }

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/admin', label: 'Back to admin' }}
          title="Users & roles"
          subtitle={`${rows.length} member${rows.length === 1 ? '' : 's'} in this tenant`}
          actions={
            <div className="flex items-center gap-2">
              <Link href="/admin/roles">
                <Button variant="outline">Manage roles</Button>
              </Link>
              <Link href="/admin/users/invite">
                <Button>Invite user</Button>
              </Link>
            </div>
          }
        />

        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => {
            const active = statusFilter === f.value
            return (
              <Link
                key={f.value}
                href={mergeHref(basePath, sp, { status: f.value === 'all' ? undefined : f.value })}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-teal-600 bg-teal-50 text-teal-800 dark:border-teal-500 dark:bg-teal-950/50 dark:text-teal-300'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800/60',
                )}
              >
                {f.label}
              </Link>
            )
          })}
        </div>

        {sorted.length === 0 ? (
          <EmptyState
            title="No members match"
            description="Try a different status filter, or invite someone."
          />
        ) : (
          <>
            {/* Phones: tappable cards. */}
            <MobileCardList>
              {sorted.map((r) => (
                <ListCard
                  key={r.membershipId}
                  href={`/admin/users/${r.membershipId}`}
                  avatarName={r.displayName ?? r.name}
                  title={
                    <span className="flex items-center gap-1.5">
                      {r.displayName ?? r.name}
                      {r.isSuperAdmin ? (
                        <Badge variant="warning" className="text-[10px]">
                          super-admin
                        </Badge>
                      ) : null}
                    </span>
                  }
                  status={<Badge variant={statusVariant(r.status)}>{r.status}</Badge>}
                  meta={r.email}
                  footer={
                    r.roleNames.length === 0 ? (
                      <span className="text-xs text-slate-400">No roles</span>
                    ) : (
                      r.roleNames.map((n) => (
                        <Badge key={n} variant="outline" className="text-[10px]">
                          {n}
                        </Badge>
                      ))
                    )
                  }
                />
              ))}
            </MobileCardList>

            {/* Tablet/desktop: sortable table. */}
            <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white sm:block dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                    <SortTh column="name" {...sortProps}>
                      Name
                    </SortTh>
                    <SortTh column="email" {...sortProps}>
                      Email
                    </SortTh>
                    <SortTh column="status" {...sortProps}>
                      Status
                    </SortTh>
                    <th className="px-3 py-2">Roles</th>
                    <SortTh column="joined" {...sortProps}>
                      Joined
                    </SortTh>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sorted.map((r) => (
                    <tr
                      key={r.membershipId}
                      className="hover:bg-slate-50/50 dark:hover:bg-slate-800/60"
                    >
                      <td className="px-3 py-2">
                        <Link
                          href={`/admin/users/${r.membershipId}` as any}
                          className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                        >
                          {r.displayName ?? r.name}
                        </Link>
                        {r.isSuperAdmin ? (
                          <Badge variant="warning" className="ml-2 text-[10px]">
                            super-admin
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{r.email}</td>
                      <td className="px-3 py-2">
                        <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {r.roleNames.length === 0 ? (
                            <span className="text-xs text-slate-400">No roles</span>
                          ) : (
                            r.roleNames.map((n) => (
                              <Badge key={n} variant="outline">
                                {n}
                              </Badge>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                        {r.joinedAt ? new Date(r.joinedAt).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </PageContainer>
  )
}
