import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { notFound, redirect } from 'next/navigation'
import { and, asc, count, desc, eq, exists, ilike, inArray, or, type SQL } from 'drizzle-orm'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  Input,
  Label,
  Select,
} from '@beaconhs/ui'
import { db, withSuperAdmin } from '@beaconhs/db'
import { roleAssignments, roles, tenantUsers, tenants, users } from '@beaconhs/db/schema'
import { getCurrentUserId, getRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { PageContainer } from '@/components/page-layout'
import { ConfirmButton } from '@/components/confirm-button'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortTh } from '@/components/sortable-th'
import { TableToolbar } from '@/components/table-toolbar'
import { parseListParams, pickString } from '@/lib/list-params'
import { AddMembershipForm } from '../_components/add-membership-form'
import {
  openMembershipInTenant,
  removeMembership,
  resendInvite,
  setMembershipStatus,
  setSuperAdmin,
  updateIdentity,
} from '../_actions'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0c25e3aac46762') }
}
export const dynamic = 'force-dynamic'

const MEMBERSHIP_SORTS = ['tenant', 'status', 'joined'] as const

type MembershipStatus = 'active' | 'invited' | 'suspended'

function statusVariant(status: MembershipStatus) {
  return status === 'active' ? 'success' : status === 'invited' ? 'secondary' : 'destructive'
}

export default async function PlatformUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  const sessionUserId = await getCurrentUserId()
  if (!sessionUserId) redirect('/login')
  const requestContext = await getRequestContext()
  const timeZone = requestContext?.timezone ?? 'UTC'
  const locale = requestContext?.locale ?? 'en'
  const sp = await searchParams
  const error = typeof sp.error === 'string' ? sp.error : undefined
  const notice = typeof sp.notice === 'string' ? sp.notice : undefined
  const statusParam = pickString(sp.membershipStatus)
  const membershipStatus =
    statusParam === 'active' || statusParam === 'invited' || statusParam === 'suspended'
      ? statusParam
      : undefined
  const membershipParams = parseListParams(
    {
      q: sp.membershipQ,
      sort: sp.membershipSort,
      dir: sp.membershipDir,
      page: sp.membershipPage,
      perPage: sp.membershipPerPage,
    },
    { sort: 'tenant', dir: 'asc', perPage: 10, allowedSorts: MEMBERSHIP_SORTS },
  )

  const data = await withSuperAdmin(db, async (tx) => {
    const [account] = await tx.select().from(users).where(eq(users.id, id)).limit(1)
    if (!account) return null
    const search: SQL<unknown> | undefined = membershipParams.q
      ? or(
          ilike(tenants.name, `%${membershipParams.q}%`),
          ilike(tenants.slug, `%${membershipParams.q}%`),
          exists(
            tx
              .select({ id: roleAssignments.id })
              .from(roleAssignments)
              .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
              .where(
                and(
                  eq(roleAssignments.tenantUserId, tenantUsers.id),
                  ilike(roles.name, `%${membershipParams.q}%`),
                ),
              ),
          ),
        )
      : undefined
    const baseWhere = eq(tenantUsers.userId, id)
    const where = and(
      baseWhere,
      search,
      membershipStatus ? eq(tenantUsers.status, membershipStatus) : undefined,
    )
    const dirFn = membershipParams.dir === 'asc' ? asc : desc
    const orderBy =
      membershipParams.sort === 'status'
        ? [dirFn(tenantUsers.status), asc(tenants.name)]
        : membershipParams.sort === 'joined'
          ? [dirFn(tenantUsers.joinedAt), asc(tenants.name)]
          : [dirFn(tenants.name)]
    const [totalRow, statusRows, memberRows, memberTenantRows, allTenants] = await Promise.all([
      tx
        .select({ c: count() })
        .from(tenantUsers)
        .innerJoin(tenants, eq(tenants.id, tenantUsers.tenantId))
        .where(where),
      tx
        .select({ status: tenantUsers.status, c: count() })
        .from(tenantUsers)
        .innerJoin(tenants, eq(tenants.id, tenantUsers.tenantId))
        .where(and(baseWhere, search))
        .groupBy(tenantUsers.status),
      tx
        .select({ membership: tenantUsers, tenant: tenants })
        .from(tenantUsers)
        .innerJoin(tenants, eq(tenants.id, tenantUsers.tenantId))
        .where(where)
        .orderBy(...orderBy)
        .limit(membershipParams.perPage)
        .offset((membershipParams.page - 1) * membershipParams.perPage),
      tx
        .select({ tenantId: tenantUsers.tenantId, status: tenantUsers.status })
        .from(tenantUsers)
        .where(baseWhere),
      tx.select({ id: tenants.id, name: tenants.name }).from(tenants).orderBy(asc(tenants.name)),
    ])
    const pageMembershipIds = memberRows.map((row) => row.membership.id)
    const roleRows =
      pageMembershipIds.length === 0
        ? []
        : await tx
            .select({ tenantUserId: roleAssignments.tenantUserId, roleName: roles.name })
            .from(roleAssignments)
            .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
            .where(inArray(roleAssignments.tenantUserId, pageMembershipIds))
            .orderBy(asc(roles.name))
    const memberTenantIds = new Set(memberTenantRows.map((row) => row.tenantId))
    const eligibleTenantIds = allTenants
      .filter((tenant) => !memberTenantIds.has(tenant.id))
      .map((tenant) => tenant.id)
    const allRoles =
      eligibleTenantIds.length === 0
        ? []
        : await tx
            .select({ id: roles.id, name: roles.name, tenantId: roles.tenantId })
            .from(roles)
            .where(inArray(roles.tenantId, eligibleTenantIds))
            .orderBy(asc(roles.name))
    return {
      account,
      memberRows,
      roleRows,
      allTenants,
      allRoles,
      memberTenantIds,
      total: Number(totalRow[0]?.c ?? 0),
      statusCounts: Object.fromEntries(statusRows.map((row) => [row.status, Number(row.c)])),
      membershipCount: memberTenantRows.length,
      activeCount: memberTenantRows.filter((row) => row.status === 'active').length,
    }
  })

  if (!data) notFound()
  const {
    account,
    memberRows,
    roleRows,
    allTenants,
    allRoles,
    memberTenantIds,
    total,
    statusCounts,
    membershipCount,
    activeCount,
  } = data

  const rolesByMembership = new Map<string, string[]>()
  for (const r of roleRows) {
    const arr = rolesByMembership.get(r.tenantUserId) ?? []
    arr.push(r.roleName)
    rolesByMembership.set(r.tenantUserId, arr)
  }

  const eligibleTenants = allTenants.filter((t) => !memberTenantIds.has(t.id))
  const rolesByTenant: Record<string, { id: string; name: string }[]> = {}
  for (const t of eligibleTenants) rolesByTenant[t.id] = []
  for (const r of allRoles) {
    const bucket = rolesByTenant[r.tenantId]
    if (bucket) bucket.push({ id: r.id, name: r.name })
  }

  const membershipBase = `/platform/users/${account.id}`
  const membershipSortProps = {
    basePath: membershipBase,
    currentParams: sp,
    sort: membershipParams.sort,
    dir: membershipParams.dir,
    sortParamKey: 'membershipSort',
    dirParamKey: 'membershipDir',
    pageParamKey: 'membershipPage',
  }

  // Full IANA list (searchable Select) — a free-text time zone would let a typo
  // silently break the target user's local-time rendering. Mirrors
  // account/_profile-form.tsx: surface 'UTC' plus the stored value even when the
  // engine omits them.
  const timezones = (() => {
    let z: string[] = []
    try {
      z =
        (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
          'timeZone',
        ) ?? []
    } catch {
      z = []
    }
    const withUtc = ['UTC', ...z.filter((t) => t !== 'UTC')]
    return withUtc.includes(account.timezone) ? withUtc : [account.timezone, ...withUtc]
  })()

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/platform/users', label: 'Back to users' }}
          title={tGeneratedValue(account.name)}
          subtitle={tGeneratedValue(account.email)}
          badge={
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                <GeneratedValue value={membershipCount} /> <GeneratedText id="m_1cbe33a8175e7b" />
                <GeneratedValue
                  value={membershipCount === 1 ? '' : <GeneratedText id="m_00ded356f0f424" />}
                />
              </Badge>
              <GeneratedValue
                value={
                  account.isSuperAdmin ? (
                    <Badge variant="warning">
                      <GeneratedText id="m_1ee09be62a0f9f" />
                    </Badge>
                  ) : null
                }
              />
            </div>
          }
        />

        <GeneratedValue
          value={
            error ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                <GeneratedValue value={error} />
              </div>
            ) : null
          }
        />
        <GeneratedValue
          value={
            notice ? (
              <div className="rounded-md border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300">
                <GeneratedValue value={notice} />
              </div>
            ) : null
          }
        />

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>
                <GeneratedText id="m_12d19c79b0d777" />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form action={updateIdentity} className="space-y-4">
                <input type="hidden" name="userId" value={account.id} />
                <div className="space-y-1.5">
                  <Label htmlFor="name">
                    <GeneratedText id="m_02b18d5c7f6f2d" />
                  </Label>
                  <Input id="name" name="name" defaultValue={account.name} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="timezone">
                    <GeneratedText id="m_18dd6072735a83" />
                  </Label>
                  <Select id="timezone" name="timezone" defaultValue={account.timezone} searchable>
                    <GeneratedValue
                      value={timezones.map((t) => (
                        <option key={t} value={t}>
                          <GeneratedValue value={t} />
                        </option>
                      ))}
                    />
                  </Select>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" variant="outline">
                    <GeneratedText id="m_0897773557f858" />
                  </Button>
                </div>
              </form>

              <dl className="grid grid-cols-3 gap-x-3 gap-y-2 border-t border-slate-100 pt-4 text-sm dark:border-slate-800">
                <dt className="text-slate-500 dark:text-slate-400">
                  <GeneratedText id="m_00a0ba9938bdff" />
                </dt>
                <dd className="col-span-2 text-slate-900 dark:text-slate-100">
                  <GeneratedValue value={account.email} />
                </dd>
                <dt className="text-slate-500 dark:text-slate-400">
                  <GeneratedText id="m_10cbe051fb5e05" />
                </dt>
                <dd className="col-span-2 text-slate-900 dark:text-slate-100">
                  <GeneratedValue
                    value={formatDate(new Date(account.createdAt), timeZone, locale)}
                  />
                </dd>
              </dl>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_0bfaf306278f3a" />
              </p>

              <div className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      <GeneratedText id="m_1db87d487dfb0a" />
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      <GeneratedText id="m_1cc58b1764c0fd" />
                    </p>
                  </div>
                  <form action={setSuperAdmin}>
                    <input type="hidden" name="userId" value={account.id} />
                    <input type="hidden" name="value" value={account.isSuperAdmin ? 'off' : 'on'} />
                    <ConfirmButton
                      type="submit"
                      variant={account.isSuperAdmin ? 'outline' : 'default'}
                      message={tGeneratedValue(
                        account.isSuperAdmin
                          ? tGenerated('m_041413948dd67c', { value0: account.name })
                          : tGenerated('m_1a7d86bb7fcc59', { value0: account.name }),
                      )}
                    >
                      <GeneratedValue
                        value={
                          account.isSuperAdmin ? (
                            <GeneratedText id="m_18718dd379a57d" />
                          ) : (
                            <GeneratedText id="m_18e71b8872fe55" />
                          )
                        }
                      />
                    </ConfirmButton>
                  </form>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <GeneratedText id="m_0ca1f6620c45a6" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AddMembershipForm
                userId={account.id}
                tenants={eligibleTenants}
                rolesByTenant={rolesByTenant}
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              <GeneratedText id="m_1e4c74d78e5d05" />
              <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">
                <GeneratedValue value={activeCount} /> <GeneratedText id="m_0ce0ede879cb16" />{' '}
                <GeneratedValue value={membershipCount} />
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <TableToolbar>
              <SearchInput
                placeholder={tGenerated('m_19b524e43ffced')}
                paramKey="membershipQ"
                pageParamKey="membershipPage"
              />
              <FilterChips
                basePath={membershipBase}
                currentParams={sp}
                paramKey="membershipStatus"
                pageParamKey="membershipPage"
                label={tGenerated('m_0b9da892d6faf0')}
                options={[
                  { value: 'active', label: 'Active', count: statusCounts.active ?? 0 },
                  { value: 'invited', label: 'Invited', count: statusCounts.invited ?? 0 },
                  { value: 'suspended', label: 'Suspended', count: statusCounts.suspended ?? 0 },
                ]}
              />
            </TableToolbar>
            <GeneratedValue
              value={
                memberRows.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    <GeneratedValue
                      value={
                        membershipCount === 0 ? (
                          <GeneratedText id="m_082e8181d9f857" />
                        ) : (
                          <GeneratedText id="m_04032ff29b4a96" />
                        )
                      }
                    />
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:text-slate-400">
                          <SortTh column="tenant" {...membershipSortProps}>
                            <GeneratedText id="m_1fd4a056042e4d" />
                          </SortTh>
                          <SortTh column="status" {...membershipSortProps}>
                            <GeneratedText id="m_0b9da892d6faf0" />
                          </SortTh>
                          <th className="px-3 py-2">
                            <GeneratedText id="m_1ed71c1e30c002" />
                          </th>
                          <SortTh column="joined" {...membershipSortProps}>
                            <GeneratedText id="m_00b9a2f359be11" />
                          </SortTh>
                          <th className="px-3 py-2 text-right">
                            <GeneratedText id="m_0a7f1858f2ec46" />
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        <GeneratedValue
                          value={memberRows.map(({ membership, tenant }) => {
                            const roleNames = rolesByMembership.get(membership.id) ?? []
                            return (
                              <tr
                                key={membership.id}
                                className="hover:bg-slate-50/50 dark:hover:bg-slate-800/60"
                              >
                                <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                                  <GeneratedValue value={tenant.name} />
                                </td>
                                <td className="px-3 py-2">
                                  <Badge variant={statusVariant(membership.status)}>
                                    <GeneratedValue value={membership.status} />
                                  </Badge>
                                </td>
                                <td className="px-3 py-2">
                                  <GeneratedValue
                                    value={
                                      roleNames.length === 0 ? (
                                        <span className="text-xs text-slate-400">
                                          <GeneratedText id="m_0f1763e8701d84" />
                                        </span>
                                      ) : (
                                        <div className="flex flex-wrap gap-1">
                                          <GeneratedValue
                                            value={roleNames.map((n) => (
                                              <Badge
                                                key={n}
                                                variant="outline"
                                                className="text-[10px]"
                                              >
                                                {n}
                                              </Badge>
                                            ))}
                                          />
                                        </div>
                                      )
                                    }
                                  />
                                </td>
                                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                                  <GeneratedValue
                                    value={
                                      membership.joinedAt
                                        ? formatDate(
                                            new Date(membership.joinedAt),
                                            timeZone,
                                            locale,
                                          )
                                        : '—'
                                    }
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                                    <GeneratedValue
                                      value={
                                        tenant.status === 'active' ? (
                                          <form action={openMembershipInTenant}>
                                            <input type="hidden" name="userId" value={account.id} />
                                            <input
                                              type="hidden"
                                              name="tenantId"
                                              value={tenant.id}
                                            />
                                            <input
                                              type="hidden"
                                              name="membershipId"
                                              value={membership.id}
                                            />
                                            <Button type="submit" size="sm" variant="outline">
                                              <GeneratedText id="m_0a3e277c9e74c5" />
                                            </Button>
                                          </form>
                                        ) : null
                                      }
                                    />
                                    <GeneratedValue
                                      value={
                                        membership.status === 'active' ? (
                                          <form action={setMembershipStatus}>
                                            <input type="hidden" name="userId" value={account.id} />
                                            <input
                                              type="hidden"
                                              name="membershipId"
                                              value={membership.id}
                                            />
                                            <input type="hidden" name="status" value="suspended" />
                                            <Button type="submit" size="sm" variant="ghost">
                                              <GeneratedText id="m_1a04688da0adf6" />
                                            </Button>
                                          </form>
                                        ) : membership.status === 'suspended' ? (
                                          <form action={setMembershipStatus}>
                                            <input type="hidden" name="userId" value={account.id} />
                                            <input
                                              type="hidden"
                                              name="membershipId"
                                              value={membership.id}
                                            />
                                            <input type="hidden" name="status" value="active" />
                                            <Button type="submit" size="sm" variant="ghost">
                                              <GeneratedText id="m_04766a3c4e3582" />
                                            </Button>
                                          </form>
                                        ) : null
                                      }
                                    />
                                    <GeneratedValue
                                      value={
                                        membership.status === 'invited' ? (
                                          <form action={resendInvite}>
                                            <input type="hidden" name="userId" value={account.id} />
                                            <input
                                              type="hidden"
                                              name="membershipId"
                                              value={membership.id}
                                            />
                                            <Button type="submit" size="sm" variant="ghost">
                                              <GeneratedText id="m_103335c1de739f" />
                                            </Button>
                                          </form>
                                        ) : null
                                      }
                                    />
                                    <form action={removeMembership}>
                                      <input type="hidden" name="userId" value={account.id} />
                                      <input
                                        type="hidden"
                                        name="membershipId"
                                        value={membership.id}
                                      />
                                      <ConfirmButton
                                        type="submit"
                                        size="sm"
                                        variant="ghost"
                                        className="text-red-600 hover:text-red-700 dark:text-red-400"
                                        message={tGenerated('m_19d8febc11b586', {
                                          value0: account.name,
                                          value1: tenant.name,
                                        })}
                                      >
                                        <GeneratedText id="m_1a9d8d971b1edb" />
                                      </ConfirmButton>
                                    </form>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        />
                      </tbody>
                    </table>
                  </div>
                )
              }
            />
            <Pagination
              basePath={membershipBase}
              currentParams={sp}
              total={total}
              page={membershipParams.page}
              perPage={membershipParams.perPage}
              pageParamKey="membershipPage"
            />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
