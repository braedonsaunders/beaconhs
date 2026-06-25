import Link from 'next/link'
import { redirect } from 'next/navigation'
import { asc, eq, sql } from 'drizzle-orm'
import { Badge, DetailHeader, EmptyState, cn } from '@beaconhs/ui'
import { db } from '@beaconhs/db'
import { tenantUsers, tenants, users } from '@beaconhs/db/schema'
import { getCurrentUserId } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { SortTh } from '@/components/sortable-th'
import { ListCard, MobileCardList } from '@/components/list-card'
import { SearchInput } from '@/components/search-input'
import { mergeHref, parseListParams, pickString } from '@/lib/list-params'

export const metadata = { title: 'Users · Platform' }
export const dynamic = 'force-dynamic'

const SORTS = ['name', 'email', 'tenants', 'created'] as const
const VIEW_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'multi', label: 'Multi-tenant' },
  { value: 'super', label: 'Super-admins' },
  { value: 'none', label: 'Unassigned' },
] as const

type TenantBadge = { name: string; status: 'active' | 'invited' | 'suspended' }
type UserRow = {
  id: string
  name: string
  email: string
  isSuperAdmin: boolean
  createdAt: Date
  tenants: TenantBadge[]
}

function tenantStatusVariant(status: TenantBadge['status']) {
  return status === 'active' ? 'success' : status === 'invited' ? 'secondary' : 'destructive'
}

function TenantChips({ tenants: list }: { tenants: TenantBadge[] }) {
  if (list.length === 0) return <span className="text-xs text-slate-400">No tenants</span>
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((t) => (
        <Badge key={t.name} variant={tenantStatusVariant(t.status)} className="text-[10px]">
          {t.name}
        </Badge>
      ))}
    </div>
  )
}

export default async function PlatformUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // The /platform layout already gates super-admin; this just needs a session.
  const userId = await getCurrentUserId()
  if (!userId) redirect('/login')

  const sp = await searchParams
  const { sort, dir, q } = parseListParams(sp, { sort: 'name', dir: 'asc', allowedSorts: SORTS })
  const view = pickString(sp.view) ?? 'all'
  const query = (q ?? '').trim().toLowerCase()

  const { accounts, memberships } = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    const accountRows = await tx
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        isSuperAdmin: users.isSuperAdmin,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(asc(users.name))
    const membershipRows = await tx
      .select({
        userId: tenantUsers.userId,
        status: tenantUsers.status,
        tenantName: tenants.name,
      })
      .from(tenantUsers)
      .innerJoin(tenants, eq(tenants.id, tenantUsers.tenantId))
      .orderBy(asc(tenants.name))
    return { accounts: accountRows, memberships: membershipRows }
  })

  const byUser = new Map<string, TenantBadge[]>()
  for (const m of memberships) {
    const arr = byUser.get(m.userId) ?? []
    arr.push({ name: m.tenantName, status: m.status })
    byUser.set(m.userId, arr)
  }

  const rows: UserRow[] = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    email: a.email,
    isSuperAdmin: a.isSuperAdmin,
    createdAt: a.createdAt,
    tenants: byUser.get(a.id) ?? [],
  }))

  const filtered = rows.filter((r) => {
    if (view === 'multi' && r.tenants.length < 2) return false
    if (view === 'super' && !r.isSuperAdmin) return false
    if (view === 'none' && r.tenants.length > 0) return false
    if (!query) return true
    const haystack = [r.name, r.email, ...r.tenants.map((t) => t.name)].join(' ').toLowerCase()
    return haystack.includes(query)
  })
  const sorted = [...filtered].sort((a, b) => {
    const mult = dir === 'asc' ? 1 : -1
    switch (sort) {
      case 'email':
        return a.email.localeCompare(b.email) * mult
      case 'tenants':
        return (a.tenants.length - b.tenants.length) * mult
      case 'created':
        return (a.createdAt.getTime() - b.createdAt.getTime()) * mult
      default:
        return a.name.localeCompare(b.name) * mult
    }
  })

  const multiCount = rows.filter((r) => r.tenants.length >= 2).length
  const basePath = '/platform/users'
  const sortProps = { basePath, currentParams: sp, sort, dir }

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/platform', label: 'Back to platform' }}
          title="Users"
          subtitle={`${rows.length} global identit${rows.length === 1 ? 'y' : 'ies'} · ${multiCount} in more than one tenant`}
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput placeholder="Search name, email, or tenant…" />
          <div className="flex flex-wrap gap-1.5">
            {VIEW_FILTERS.map((f) => {
              const active = view === f.value
              return (
                <Link
                  key={f.value}
                  href={mergeHref(basePath, sp, { view: f.value === 'all' ? undefined : f.value })}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'border-amber-500 bg-amber-50 text-amber-800 dark:border-amber-500 dark:bg-amber-950/50 dark:text-amber-300'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800/60',
                  )}
                >
                  {f.label}
                </Link>
              )
            })}
          </div>
        </div>

        {sorted.length === 0 ? (
          <EmptyState
            title="No users match"
            description={
              query
                ? 'No users match your search. Try a different term or filter.'
                : 'New users appear here once they’re invited into a tenant from its Users page.'
            }
          />
        ) : (
          <>
            {/* Phones: tappable cards. */}
            <MobileCardList>
              {sorted.map((r) => (
                <ListCard
                  key={r.id}
                  href={`/platform/users/${r.id}`}
                  avatarName={r.name}
                  title={
                    <span className="flex items-center gap-1.5">
                      {r.name}
                      {r.isSuperAdmin ? (
                        <Badge variant="warning" className="text-[10px]">
                          super-admin
                        </Badge>
                      ) : null}
                    </span>
                  }
                  status={
                    <Badge variant="outline">
                      {r.tenants.length} tenant{r.tenants.length === 1 ? '' : 's'}
                    </Badge>
                  }
                  meta={r.email}
                  footer={<TenantChips tenants={r.tenants} />}
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
                    <SortTh column="tenants" {...sortProps}>
                      Tenants
                    </SortTh>
                    <th className="px-3 py-2">Memberships</th>
                    <SortTh column="created" {...sortProps}>
                      Created
                    </SortTh>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sorted.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/60">
                      <td className="px-3 py-2">
                        <Link
                          href={`/platform/users/${r.id}` as any}
                          className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                        >
                          {r.name}
                        </Link>
                        {r.isSuperAdmin ? (
                          <Badge variant="warning" className="ml-2 text-[10px]">
                            super-admin
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{r.email}</td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                        {r.tenants.length}
                      </td>
                      <td className="px-3 py-2">
                        <TenantChips tenants={r.tenants} />
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                        {new Date(r.createdAt).toLocaleDateString()}
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
