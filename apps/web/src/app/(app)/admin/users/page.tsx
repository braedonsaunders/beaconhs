import Link from 'next/link'
import { asc, eq } from 'drizzle-orm'
import {
  Badge,
  Button,
  DetailHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { roleAssignments, roles, tenantUsers, user } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Tenant users' }
export const dynamic = 'force-dynamic'

export default async function AdminUsersPage() {
  const ctx = await requireRequestContext()
  const rows = await ctx.db(async (tx) => {
    const memberRows = await tx
      .select({ membership: tenantUsers, account: user })
      .from(tenantUsers)
      .innerJoin(user, eq(user.id, tenantUsers.userId))
      .orderBy(asc(user.name))
    const allAssignments = await tx
      .select({ assignment: roleAssignments, role: roles })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    return memberRows.map((m) => ({
      ...m,
      roles: allAssignments.filter((a) => a.assignment.tenantUserId === m.membership.id),
    }))
  })

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/admin', label: 'Back to admin' }}
          title="Users & roles"
          subtitle={`${rows.length} member${rows.length === 1 ? '' : 's'} in this tenant`}
          actions={
            <Link href="/admin/users/invite">
              <Button>Invite user</Button>
            </Link>
          }
        />

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ membership, account, roles }) => (
              <TableRow key={membership.id}>
                <TableCell className="font-medium">
                  {account.name} {account.isSuperAdmin ? <Badge variant="warning">super-admin</Badge> : null}
                </TableCell>
                <TableCell className="text-slate-600">{account.email}</TableCell>
                <TableCell>
                  <Badge variant={membership.status === 'active' ? 'success' : 'secondary'}>
                    {membership.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {roles.length === 0 ? (
                      <span className="text-xs text-slate-500">no roles</span>
                    ) : (
                      roles.map((r) => (
                        <Badge key={r.assignment.id} variant="outline">
                          {r.role.name}
                        </Badge>
                      ))
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-slate-600">
                  {membership.joinedAt ? new Date(membership.joinedAt).toLocaleDateString() : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </PageContainer>
  )
}
