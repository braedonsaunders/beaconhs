import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  notExists,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { Badge, DetailHeader, EmptyState } from '@beaconhs/ui'
import { db, withSuperAdmin } from '@beaconhs/db'
import { tenantUsers, tenants, users } from '@beaconhs/db/schema'
import { getCurrentUserId, getRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { PageContainer } from '@/components/page-layout'
import { SortTh } from '@/components/sortable-th'
import { ListCard, MobileCardList } from '@/components/list-card'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { parseListParams, pickString } from '@/lib/list-params'

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
  const requestContext = await getRequestContext()
  const timeZone = requestContext?.timezone ?? 'UTC'
  const locale = requestContext?.locale ?? 'en'

  const sp = await searchParams
  const listParams = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const { sort, dir } = listParams
  const viewParam = pickString(sp.view)
  const view = VIEW_FILTERS.some((filter) => filter.value === viewParam) ? viewParam! : 'all'

  const { accounts, memberships, total, identityCount, multiCount } = await withSuperAdmin(
    db,
    async (tx) => {
      const membershipCount = sql<number>`(select count(*) from ${tenantUsers} where ${tenantUsers.userId} = ${users.id})`
      const search: SQL<unknown> | undefined = listParams.q
        ? or(
            ilike(users.name, `%${listParams.q}%`),
            ilike(users.email, `%${listParams.q}%`),
            exists(
              tx
                .select({ id: tenantUsers.id })
                .from(tenantUsers)
                .innerJoin(tenants, eq(tenants.id, tenantUsers.tenantId))
                .where(
                  and(eq(tenantUsers.userId, users.id), ilike(tenants.name, `%${listParams.q}%`)),
                ),
            ),
          )
        : undefined
      const viewWhere =
        view === 'multi'
          ? sql`${membershipCount} >= 2`
          : view === 'super'
            ? eq(users.isSuperAdmin, true)
            : view === 'none'
              ? notExists(
                  tx
                    .select({ id: tenantUsers.id })
                    .from(tenantUsers)
                    .where(eq(tenantUsers.userId, users.id)),
                )
              : undefined
      const where = and(search, viewWhere)
      const dirFn = dir === 'asc' ? asc : desc
      const orderBy =
        sort === 'email'
          ? [dirFn(users.email)]
          : sort === 'tenants'
            ? [dirFn(membershipCount), asc(users.name)]
            : sort === 'created'
              ? [dirFn(users.createdAt), asc(users.name)]
              : [dirFn(users.name)]

      const [identityRow, multiRow, totalRow, accountRows] = await Promise.all([
        tx.select({ c: count() }).from(users),
        tx
          .select({ c: count() })
          .from(users)
          .where(sql`${membershipCount} >= 2`),
        tx.select({ c: count() }).from(users).where(where),
        tx
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            isSuperAdmin: users.isSuperAdmin,
            createdAt: users.createdAt,
            membershipCount,
          })
          .from(users)
          .where(where)
          .orderBy(...orderBy)
          .limit(listParams.perPage)
          .offset((listParams.page - 1) * listParams.perPage),
      ])
      const accountIds = accountRows.map((account) => account.id)
      const membershipRows =
        accountIds.length === 0
          ? []
          : await tx
              .select({
                userId: tenantUsers.userId,
                status: tenantUsers.status,
                tenantName: tenants.name,
              })
              .from(tenantUsers)
              .innerJoin(tenants, eq(tenants.id, tenantUsers.tenantId))
              .where(inArray(tenantUsers.userId, accountIds))
              .orderBy(asc(tenants.name))
      return {
        accounts: accountRows,
        memberships: membershipRows,
        total: Number(totalRow[0]?.c ?? 0),
        identityCount: Number(identityRow[0]?.c ?? 0),
        multiCount: Number(multiRow[0]?.c ?? 0),
      }
    },
  )

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

  const basePath = '/platform/users'
  const sortProps = { basePath, currentParams: sp, sort, dir }

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/platform', label: 'Back to platform' }}
          title="Users"
          subtitle={`${identityCount} global identit${identityCount === 1 ? 'y' : 'ies'} · ${multiCount} in more than one tenant`}
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput placeholder="Search name, email, or tenant…" />
          <FilterChips
            basePath={basePath}
            currentParams={sp}
            paramKey="view"
            label="View"
            options={VIEW_FILTERS.filter((filter) => filter.value !== 'all')}
          />
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="No users match"
            description={
              listParams.q
                ? 'No users match your search. Try a different term or filter.'
                : 'New users appear here once they’re invited into a tenant from its Users page.'
            }
          />
        ) : (
          <>
            {/* Phones: tappable cards. */}
            <MobileCardList>
              {rows.map((r) => (
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
                  {rows.map((r) => (
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
                        {formatDate(new Date(r.createdAt), timeZone, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <Pagination
          basePath={basePath}
          currentParams={sp}
          total={total}
          page={listParams.page}
          perPage={listParams.perPage}
        />
      </div>
    </PageContainer>
  )
}
