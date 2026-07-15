import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, asc, count, desc, eq, exists, ilike, inArray, or, type SQL } from 'drizzle-orm'
import { Badge, Button, DetailHeader, EmptyState } from '@beaconhs/ui'
import { roleAssignments, roles, tenantUsers, users as user } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { PageContainer } from '@/components/page-layout'
import { SortTh } from '@/components/sortable-th'
import { ListCard, MobileCardList } from '@/components/list-card'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { parseListParams, pickString } from '@/lib/list-params'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0b997ac753c571') }
}
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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.users.manage')) redirect('/admin')

  const sp = await searchParams
  const listParams = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const { sort, dir } = listParams
  // Default to active members; `?status=all` is the explicit show-everything sentinel.
  const statusParam = pickString(sp.status)
  const statusFilter =
    STATUS_FILTERS.find((filter) => filter.value === statusParam)?.value ?? 'active'

  const { rows, total, activeCount, statusCounts } = await ctx.db(async (tx) => {
    const search: SQL<unknown> | undefined = listParams.q
      ? or(
          ilike(user.name, `%${listParams.q}%`),
          ilike(user.email, `%${listParams.q}%`),
          ilike(tenantUsers.displayName, `%${listParams.q}%`),
          exists(
            tx
              .select({ id: roleAssignments.id })
              .from(roleAssignments)
              .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
              .where(
                and(
                  eq(roleAssignments.tenantUserId, tenantUsers.id),
                  ilike(roles.name, `%${listParams.q}%`),
                ),
              ),
          ),
        )
      : undefined
    const where = and(
      search,
      statusFilter === 'all' ? undefined : eq(tenantUsers.status, statusFilter),
    )
    const dirFn = dir === 'asc' ? asc : desc
    const orderBy =
      sort === 'email'
        ? [dirFn(user.email)]
        : sort === 'status'
          ? [dirFn(tenantUsers.status), asc(user.name)]
          : sort === 'joined'
            ? [dirFn(tenantUsers.joinedAt), asc(user.name)]
            : [dirFn(tenantUsers.displayName), dirFn(user.name)]
    const baseCount = () =>
      tx.select({ c: count() }).from(tenantUsers).innerJoin(user, eq(user.id, tenantUsers.userId))
    const [totalRow, activeRow, countRows, memberRows] = await Promise.all([
      baseCount().where(where),
      baseCount().where(eq(tenantUsers.status, 'active')),
      tx
        .select({ status: tenantUsers.status, c: count() })
        .from(tenantUsers)
        .innerJoin(user, eq(user.id, tenantUsers.userId))
        .where(search)
        .groupBy(tenantUsers.status),
      tx
        .select({ membership: tenantUsers, account: user })
        .from(tenantUsers)
        .innerJoin(user, eq(user.id, tenantUsers.userId))
        .where(where)
        .orderBy(...orderBy)
        .limit(listParams.perPage)
        .offset((listParams.page - 1) * listParams.perPage),
    ])
    const membershipIds = memberRows.map((row) => row.membership.id)
    const assignments =
      membershipIds.length === 0
        ? []
        : await tx
            .select({ tenantUserId: roleAssignments.tenantUserId, roleName: roles.name })
            .from(roleAssignments)
            .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
            .where(inArray(roleAssignments.tenantUserId, membershipIds))
            .orderBy(asc(roles.name))
    return {
      rows: memberRows.map<MemberRow>((m) => ({
        membershipId: m.membership.id,
        name: m.account.name,
        email: m.account.email,
        displayName: m.membership.displayName,
        status: m.membership.status,
        isSuperAdmin: m.account.isSuperAdmin,
        joinedAt: m.membership.joinedAt,
        roleNames: assignments
          .filter((assignment) => assignment.tenantUserId === m.membership.id)
          .map((assignment) => assignment.roleName),
      })),
      total: Number(totalRow[0]?.c ?? 0),
      activeCount: Number(activeRow[0]?.c ?? 0),
      statusCounts: Object.fromEntries(countRows.map((row) => [row.status, Number(row.c)])),
    }
  })

  const basePath = '/admin/users'
  const sortProps = { basePath, currentParams: sp, sort, dir }

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/admin', label: 'Back to admin' }}
          title={tGenerated('m_0b997ac753c571')}
          subtitle={tGenerated('m_006fc632d9258e', {
            value0: activeCount,
            value1: activeCount === 1 ? '' : 's',
          })}
          actions={
            <div className="flex items-center gap-2">
              <Link href="/admin/roles">
                <Button variant="outline">
                  <GeneratedText id="m_18b48af6197383" />
                </Button>
              </Link>
              <Link href="/admin/users/invite">
                <Button>
                  <GeneratedText id="m_05b8de370e95a9" />
                </Button>
              </Link>
            </div>
          }
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput placeholder={tGenerated('m_1de877d73563c5')} />
          <FilterChips
            basePath={basePath}
            currentParams={sp}
            paramKey="status"
            label={tGenerated('m_0b9da892d6faf0')}
            defaultValue="active"
            options={STATUS_FILTERS.filter((filter) => filter.value !== 'all').map((filter) => ({
              value: filter.value,
              label: filter.label,
              count: statusCounts[filter.value] ?? 0,
            }))}
          />
        </div>

        <GeneratedValue
          value={
            rows.length === 0 ? (
              <EmptyState
                title={tGenerated('m_15b2e8f526882e')}
                description={tGeneratedValue(
                  listParams.q ? tGenerated('m_08826a6325e2f7') : tGenerated('m_1dd8d30789c461'),
                )}
              />
            ) : (
              <>
                {/* Phones: tappable cards. */}
                <MobileCardList>
                  <GeneratedValue
                    value={rows.map((r) => (
                      <ListCard
                        key={r.membershipId}
                        href={`/admin/users/${r.membershipId}`}
                        avatarName={r.displayName ?? r.name}
                        title={tGeneratedValue(
                          <span className="flex items-center gap-1.5">
                            {r.displayName ?? r.name}
                            {r.isSuperAdmin ? (
                              <Badge variant="warning" className="text-[10px]">
                                super-admin
                              </Badge>
                            ) : null}
                          </span>,
                        )}
                        status={
                          <Badge variant={statusVariant(r.status)}>
                            <GeneratedValue value={r.status} />
                          </Badge>
                        }
                        meta={r.email}
                        footer={
                          r.roleNames.length === 0 ? (
                            <span className="text-xs text-slate-400">
                              <GeneratedText id="m_0f1763e8701d84" />
                            </span>
                          ) : (
                            r.roleNames.map((n) => (
                              <Badge key={n} variant="outline" className="text-[10px]">
                                <GeneratedValue value={n} />
                              </Badge>
                            ))
                          )
                        }
                      />
                    ))}
                  />
                </MobileCardList>

                {/* Tablet/desktop: sortable table. */}
                <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white sm:block dark:border-slate-800 dark:bg-slate-900">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                        <SortTh column="name" {...sortProps}>
                          <GeneratedText id="m_02b18d5c7f6f2d" />
                        </SortTh>
                        <SortTh column="email" {...sortProps}>
                          <GeneratedText id="m_00a0ba9938bdff" />
                        </SortTh>
                        <SortTh column="status" {...sortProps}>
                          <GeneratedText id="m_0b9da892d6faf0" />
                        </SortTh>
                        <th className="px-3 py-2">
                          <GeneratedText id="m_1ed71c1e30c002" />
                        </th>
                        <SortTh column="joined" {...sortProps}>
                          <GeneratedText id="m_00b9a2f359be11" />
                        </SortTh>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      <GeneratedValue
                        value={rows.map((r) => (
                          <tr
                            key={r.membershipId}
                            className="hover:bg-slate-50/50 dark:hover:bg-slate-800/60"
                          >
                            <td className="px-3 py-2">
                              <Link
                                href={`/admin/users/${r.membershipId}` as any}
                                className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                              >
                                <GeneratedValue value={r.displayName ?? r.name} />
                              </Link>
                              <GeneratedValue
                                value={
                                  r.isSuperAdmin ? (
                                    <Badge variant="warning" className="ml-2 text-[10px]">
                                      <GeneratedText id="m_1ee09be62a0f9f" />
                                    </Badge>
                                  ) : null
                                }
                              />
                            </td>
                            <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                              <GeneratedValue value={r.email} />
                            </td>
                            <td className="px-3 py-2">
                              <Badge variant={statusVariant(r.status)}>
                                <GeneratedValue value={r.status} />
                              </Badge>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-1">
                                <GeneratedValue
                                  value={
                                    r.roleNames.length === 0 ? (
                                      <span className="text-xs text-slate-400">
                                        <GeneratedText id="m_0f1763e8701d84" />
                                      </span>
                                    ) : (
                                      r.roleNames.map((n) => (
                                        <Badge key={n} variant="outline">
                                          <GeneratedValue value={n} />
                                        </Badge>
                                      ))
                                    )
                                  }
                                />
                              </div>
                            </td>
                            <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                              <GeneratedValue
                                value={
                                  r.joinedAt
                                    ? formatDate(new Date(r.joinedAt), ctx.timezone, ctx.locale)
                                    : '—'
                                }
                              />
                            </td>
                          </tr>
                        ))}
                      />
                    </tbody>
                  </table>
                </div>
              </>
            )
          }
        />
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
