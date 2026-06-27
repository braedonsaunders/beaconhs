import Link from 'next/link'
import { redirect } from 'next/navigation'
import { asc, count, eq } from 'drizzle-orm'
import { Badge, Button, DetailHeader, EmptyState } from '@beaconhs/ui'
import { roleAssignments, roles, tenantUsers, user } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { SortTh } from '@/components/sortable-th'
import { parseListParams } from '@/lib/list-params'
import { loadScopeOptions } from '../users/_scope-data'
import { BulkRoleAssignmentForm } from './_components/bulk-role-assignment-form'

export const metadata = { title: 'Roles' }
export const dynamic = 'force-dynamic'

const SORTS = ['name', 'permissions', 'members'] as const

export default async function AdminRolesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.roles.manage')) redirect('/admin')
  const sp = await searchParams
  const { sort, dir } = parseListParams(sp, { sort: 'name', dir: 'asc', allowedSorts: SORTS })
  const error = typeof sp.error === 'string' ? sp.error : undefined
  const notice = typeof sp.notice === 'string' ? sp.notice : undefined
  const canBulkManageRoles = can(ctx, 'admin.users.manage')

  const data = await ctx.db(async (tx) => {
    const roleRows = await tx.select().from(roles).orderBy(asc(roles.name))
    const counts = await tx
      .select({ roleId: roleAssignments.roleId, n: count() })
      .from(roleAssignments)
      .groupBy(roleAssignments.roleId)
    const memberRows = canBulkManageRoles
      ? await tx
          .select({
            membershipId: tenantUsers.id,
            userId: tenantUsers.userId,
            status: tenantUsers.status,
            displayName: tenantUsers.displayName,
            name: user.name,
            email: user.email,
            isSuperAdmin: user.isSuperAdmin,
          })
          .from(tenantUsers)
          .innerJoin(user, eq(user.id, tenantUsers.userId))
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
    const countByRole = new Map(counts.map((c) => [c.roleId, Number(c.n)]))
    return {
      roles: roleRows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isBuiltIn: r.isBuiltIn,
        permissionCount: r.permissions.length,
        memberCount: countByRole.get(r.id) ?? 0,
      })),
      members: memberRows.map((m) => ({
        id: m.membershipId,
        name: m.name,
        email: m.email,
        displayName: m.displayName,
        status: m.status,
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

  const sorted = [...rows].sort((a, b) => {
    const mult = dir === 'asc' ? 1 : -1
    switch (sort) {
      case 'permissions':
        return (a.permissionCount - b.permissionCount) * mult
      case 'members':
        return (a.memberCount - b.memberCount) * mult
      default:
        return a.name.localeCompare(b.name) * mult
    }
  })

  const basePath = '/admin/roles'
  const sortProps = { basePath, currentParams: sp, sort, dir }

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/admin', label: 'Back to admin' }}
          title="Roles"
          subtitle="Bundles of permissions you assign to members."
          actions={
            <div className="flex items-center gap-2 whitespace-nowrap">
              {scopeOptions ? (
                <BulkRoleAssignmentForm
                  roles={rows.map((role) => ({
                    id: role.id,
                    name: role.name,
                    isBuiltIn: role.isBuiltIn,
                  }))}
                  members={data.members}
                  scopeOptions={scopeOptions}
                />
              ) : null}
              <Link href="/admin/roles/new">
                <Button>New role</Button>
              </Link>
            </div>
          }
        />

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-md border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300">
            {notice}
          </div>
        ) : null}

        {sorted.length === 0 ? (
          <EmptyState title="No roles" description="Create a role to start assigning access." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                  <SortTh column="name" {...sortProps}>
                    Name
                  </SortTh>
                  <th className="px-3 py-2">Description</th>
                  <SortTh column="permissions" {...sortProps}>
                    Permissions
                  </SortTh>
                  <SortTh column="members" {...sortProps}>
                    Members
                  </SortTh>
                  <th className="px-3 py-2">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {sorted.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/60">
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/roles/${r.id}` as any}
                        className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="max-w-md px-3 py-2 text-slate-600 dark:text-slate-400">
                      <span className="line-clamp-1">{r.description ?? '—'}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                      {r.permissionCount}
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                      {r.memberCount}
                    </td>
                    <td className="px-3 py-2">
                      {r.isBuiltIn ? (
                        <Badge variant="secondary">Built-in</Badge>
                      ) : (
                        <Badge variant="outline">Custom</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageContainer>
  )
}
