import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import { Badge, Button, DetailHeader, EmptyState } from '@beaconhs/ui'
import { roleAssignments, roles, tenantUsers, users as user } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { SortTh } from '@/components/sortable-th'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { parseListParams, pickString } from '@/lib/list-params'
import { loadScopeOptions } from '../users/_scope-data'
import { BulkRoleAssignmentForm } from './_components/bulk-role-assignment-form'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1ed71c1e30c002') }
}
export const dynamic = 'force-dynamic'

const SORTS = ['name', 'permissions', 'members'] as const
const BASE = '/admin/roles'

export default async function AdminRolesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.roles.manage')) redirect('/admin')
  const sp = await searchParams
  const listParams = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const { sort, dir } = listParams
  const typeParam = pickString(sp.type)
  const typeFilter = typeParam === 'built_in' || typeParam === 'custom' ? typeParam : undefined
  const error = typeof sp.error === 'string' ? sp.error : undefined
  const notice = typeof sp.notice === 'string' ? sp.notice : undefined
  const canBulkManageRoles = can(ctx, 'admin.users.manage')

  const data = await ctx.db(async (tx) => {
    const search: SQL<unknown> | undefined = listParams.q
      ? or(ilike(roles.name, `%${listParams.q}%`), ilike(roles.description, `%${listParams.q}%`))
      : undefined
    const type =
      typeFilter === 'built_in'
        ? eq(roles.isBuiltIn, true)
        : typeFilter === 'custom'
          ? eq(roles.isBuiltIn, false)
          : undefined
    const where = and(search, type)
    const permissionCount = sql<number>`coalesce(array_length(${roles.permissions}, 1), 0)`
    const memberCount = sql<number>`count(${roleAssignments.id}) filter (where ${tenantUsers.status} = 'active')`
    const dirFn = dir === 'asc' ? asc : desc
    const orderBy =
      sort === 'permissions'
        ? [dirFn(permissionCount), asc(roles.name)]
        : sort === 'members'
          ? [dirFn(memberCount), asc(roles.name)]
          : [dirFn(roles.name)]
    const [totalRow, typeRows, roleRows, allRoleOptions] = await Promise.all([
      tx.select({ c: count() }).from(roles).where(where),
      tx
        .select({ isBuiltIn: roles.isBuiltIn, c: count() })
        .from(roles)
        .where(search)
        .groupBy(roles.isBuiltIn),
      tx
        .select({
          id: roles.id,
          name: roles.name,
          description: roles.description,
          isBuiltIn: roles.isBuiltIn,
          permissionCount,
          memberCount,
        })
        .from(roles)
        .leftJoin(roleAssignments, eq(roleAssignments.roleId, roles.id))
        .leftJoin(tenantUsers, eq(tenantUsers.id, roleAssignments.tenantUserId))
        .where(where)
        .groupBy(roles.id)
        .orderBy(...orderBy)
        .limit(listParams.perPage)
        .offset((listParams.page - 1) * listParams.perPage),
      canBulkManageRoles
        ? tx
            .select({ id: roles.id, name: roles.name, isBuiltIn: roles.isBuiltIn })
            .from(roles)
            .orderBy(asc(roles.name))
        : Promise.resolve([]),
    ])
    const memberRows = canBulkManageRoles
      ? await tx
          .select({
            membershipId: tenantUsers.id,
            userId: tenantUsers.userId,
            displayName: tenantUsers.displayName,
            name: user.name,
            email: user.email,
            isSuperAdmin: user.isSuperAdmin,
          })
          .from(tenantUsers)
          .innerJoin(user, eq(user.id, tenantUsers.userId))
          .where(eq(tenantUsers.status, 'active'))
          .orderBy(asc(user.name))
      : []
    const allAssignments = canBulkManageRoles
      ? await tx
          .select({
            tenantUserId: roleAssignments.tenantUserId,
            roleId: roles.id,
            roleName: roles.name,
          })
          .from(roleAssignments)
          .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
          .orderBy(asc(roles.name))
      : []
    return {
      roles: roleRows.map((r) => ({
        ...r,
        permissionCount: Number(r.permissionCount),
        memberCount: Number(r.memberCount),
      })),
      allRoleOptions,
      total: Number(totalRow[0]?.c ?? 0),
      typeCounts: Object.fromEntries(
        typeRows.map((row) => [row.isBuiltIn ? 'built_in' : 'custom', Number(row.c)]),
      ),
      members: memberRows.map((m) => ({
        id: m.membershipId,
        name: m.name,
        email: m.email,
        displayName: m.displayName,
        isSelf: m.userId === ctx.userId,
        isProtectedSuperAdmin: m.isSuperAdmin && !ctx.isSuperAdmin,
        roles: allAssignments
          .filter((assignment) => assignment.tenantUserId === m.membershipId)
          .map((assignment) => ({ id: assignment.roleId, name: assignment.roleName })),
      })),
    }
  })
  const rows = data.roles
  const scopeOptions = canBulkManageRoles ? await loadScopeOptions(ctx) : null

  const sortProps = { basePath: BASE, currentParams: sp, sort, dir }

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/admin', label: 'Back to admin' }}
          title={tGenerated('m_1ed71c1e30c002')}
          subtitle={tGenerated('m_0a95f0af2a4546')}
          actions={
            <div className="flex items-center gap-2 whitespace-nowrap">
              <GeneratedValue
                value={
                  scopeOptions ? (
                    <BulkRoleAssignmentForm
                      roles={data.allRoleOptions}
                      members={data.members}
                      scopeOptions={scopeOptions}
                    />
                  ) : null
                }
              />
              <Link href="/admin/roles/new">
                <Button>
                  <GeneratedText id="m_166bee8f545e03" />
                </Button>
              </Link>
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

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput placeholder={tGenerated('m_16049bdab5e799')} />
          <FilterChips
            basePath={BASE}
            currentParams={sp}
            paramKey="type"
            label={tGenerated('m_074ba2f160c506')}
            options={[
              { value: 'built_in', label: 'Built-in', count: data.typeCounts.built_in ?? 0 },
              { value: 'custom', label: 'Custom', count: data.typeCounts.custom ?? 0 },
            ]}
          />
        </div>

        <GeneratedValue
          value={
            rows.length === 0 ? (
              <EmptyState
                title={tGeneratedValue(
                  !listParams.q && !typeFilter
                    ? tGenerated('m_0f1763e8701d84')
                    : tGenerated('m_0ae43c02f5c18b'),
                )}
                description={tGeneratedValue(
                  !listParams.q && !typeFilter
                    ? tGenerated('m_09f55428d4bd7f')
                    : tGenerated('m_10cb445cb3e7bf'),
                )}
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                      <SortTh column="name" {...sortProps}>
                        <GeneratedText id="m_02b18d5c7f6f2d" />
                      </SortTh>
                      <th className="px-3 py-2">
                        <GeneratedText id="m_14d923495cf14c" />
                      </th>
                      <SortTh column="permissions" {...sortProps}>
                        <GeneratedText id="m_0f16ebbc2ed672" />
                      </SortTh>
                      <SortTh column="members" {...sortProps}>
                        <GeneratedText id="m_0ef3898622f868" />
                      </SortTh>
                      <th className="px-3 py-2">
                        <GeneratedText id="m_074ba2f160c506" />
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    <GeneratedValue
                      value={rows.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/60">
                          <td className="px-3 py-2">
                            <Link
                              href={`/admin/roles/${r.id}` as any}
                              className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                            >
                              <GeneratedValue value={r.name} />
                            </Link>
                          </td>
                          <td className="max-w-md px-3 py-2 text-slate-600 dark:text-slate-400">
                            <span className="line-clamp-1">
                              <GeneratedValue value={r.description ?? '—'} />
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                            <GeneratedValue value={r.permissionCount} />
                          </td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                            <GeneratedValue value={r.memberCount} />
                          </td>
                          <td className="px-3 py-2">
                            <GeneratedValue
                              value={
                                r.isBuiltIn ? (
                                  <Badge variant="secondary">
                                    <GeneratedText id="m_09bfd82959f8d2" />
                                  </Badge>
                                ) : (
                                  <Badge variant="outline">
                                    <GeneratedText id="m_1721ac81d2a5c0" />
                                  </Badge>
                                )
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    />
                  </tbody>
                </table>
              </div>
            )
          }
        />
        <Pagination
          basePath={BASE}
          currentParams={sp}
          total={data.total}
          page={listParams.page}
          perPage={listParams.perPage}
        />
      </div>
    </PageContainer>
  )
}
