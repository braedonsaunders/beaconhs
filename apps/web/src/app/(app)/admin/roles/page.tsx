import Link from 'next/link'
import { redirect } from 'next/navigation'
import { asc, count, eq } from 'drizzle-orm'
import { Badge, Button, DetailHeader, EmptyState } from '@beaconhs/ui'
import { roleAssignments, roles } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { SortTh } from '@/components/sortable-th'
import { parseListParams } from '@/lib/list-params'

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

  const rows = await ctx.db(async (tx) => {
    const roleRows = await tx.select().from(roles).orderBy(asc(roles.name))
    const counts = await tx
      .select({ roleId: roleAssignments.roleId, n: count() })
      .from(roleAssignments)
      .groupBy(roleAssignments.roleId)
    const countByRole = new Map(counts.map((c) => [c.roleId, Number(c.n)]))
    return roleRows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isBuiltIn: r.isBuiltIn,
      permissionCount: r.permissions.length,
      memberCount: countByRole.get(r.id) ?? 0,
    }))
  })

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
          back={{ href: '/admin/users', label: 'Back to users' }}
          title="Roles"
          subtitle="Bundles of permissions you assign to members."
          actions={
            <Link href="/admin/roles/new">
              <Button>New role</Button>
            </Link>
          }
        />

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
