import { notFound, redirect } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
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
import { getCurrentUserId } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { ConfirmButton } from '../_components/confirm-button'
import { AddMembershipForm } from '../_components/add-membership-form'
import {
  openMembershipInTenant,
  removeMembership,
  resendInvite,
  setMembershipStatus,
  setSuperAdmin,
  updateIdentity,
} from '../_actions'

export const metadata = { title: 'User · Platform' }
export const dynamic = 'force-dynamic'

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
  const sessionUserId = await getCurrentUserId()
  if (!sessionUserId) redirect('/login')
  const { id } = await params
  const sp = await searchParams
  const error = typeof sp.error === 'string' ? sp.error : undefined
  const notice = typeof sp.notice === 'string' ? sp.notice : undefined

  const data = await withSuperAdmin(db, async (tx) => {
    const [account] = await tx.select().from(users).where(eq(users.id, id)).limit(1)
    if (!account) return null
    const memberRows = await tx
      .select({ membership: tenantUsers, tenant: tenants })
      .from(tenantUsers)
      .innerJoin(tenants, eq(tenants.id, tenantUsers.tenantId))
      .where(eq(tenantUsers.userId, id))
      .orderBy(asc(tenants.name))
    const roleRows = await tx
      .select({ tenantUserId: roleAssignments.tenantUserId, roleName: roles.name })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .innerJoin(tenantUsers, eq(tenantUsers.id, roleAssignments.tenantUserId))
      .where(eq(tenantUsers.userId, id))
    const allTenants = await tx
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .orderBy(asc(tenants.name))
    const allRoles = await tx
      .select({ id: roles.id, name: roles.name, tenantId: roles.tenantId })
      .from(roles)
      .orderBy(asc(roles.name))
    return { account, memberRows, roleRows, allTenants, allRoles }
  })

  if (!data) notFound()
  const { account, memberRows, roleRows, allTenants, allRoles } = data

  const rolesByMembership = new Map<string, string[]>()
  for (const r of roleRows) {
    const arr = rolesByMembership.get(r.tenantUserId) ?? []
    arr.push(r.roleName)
    rolesByMembership.set(r.tenantUserId, arr)
  }

  const memberTenantIds = new Set(memberRows.map((m) => m.tenant.id))
  const eligibleTenants = allTenants.filter((t) => !memberTenantIds.has(t.id))
  const rolesByTenant: Record<string, { id: string; name: string }[]> = {}
  for (const t of eligibleTenants) rolesByTenant[t.id] = []
  for (const r of allRoles) {
    const bucket = rolesByTenant[r.tenantId]
    if (bucket) bucket.push({ id: r.id, name: r.name })
  }

  const activeCount = memberRows.filter((m) => m.membership.status === 'active').length

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/platform/users', label: 'Back to users' }}
          title={account.name}
          subtitle={account.email}
          badge={
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {memberRows.length} tenant{memberRows.length === 1 ? '' : 's'}
              </Badge>
              {account.isSuperAdmin ? <Badge variant="warning">super-admin</Badge> : null}
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

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Identity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form action={updateIdentity} className="space-y-4">
                <input type="hidden" name="userId" value={account.id} />
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" name="name" defaultValue={account.name} required />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="locale">Language</Label>
                    <Select id="locale" name="locale" defaultValue={account.locale}>
                      <option value="en">English</option>
                      <option value="fr">French</option>
                      <option value="es">Spanish</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="timezone">Time zone</Label>
                    <Input id="timezone" name="timezone" defaultValue={account.timezone} />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" variant="outline">
                    Save identity
                  </Button>
                </div>
              </form>

              <dl className="grid grid-cols-3 gap-x-3 gap-y-2 border-t border-slate-100 pt-4 text-sm dark:border-slate-800">
                <dt className="text-slate-500 dark:text-slate-400">Email</dt>
                <dd className="col-span-2 text-slate-900 dark:text-slate-100">{account.email}</dd>
                <dt className="text-slate-500 dark:text-slate-400">Created</dt>
                <dd className="col-span-2 text-slate-900 dark:text-slate-100">
                  {new Date(account.createdAt).toLocaleDateString()}
                </dd>
              </dl>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Email, password and sessions are managed per tenant — use “Open in tenant” on a
                membership below.
              </p>

              <div className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      Super-admin
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Full platform access across every tenant. Grant sparingly.
                    </p>
                  </div>
                  <form action={setSuperAdmin}>
                    <input type="hidden" name="userId" value={account.id} />
                    <input type="hidden" name="value" value={account.isSuperAdmin ? 'off' : 'on'} />
                    <ConfirmButton
                      type="submit"
                      variant={account.isSuperAdmin ? 'outline' : 'default'}
                      confirmMessage={
                        account.isSuperAdmin
                          ? `Revoke super-admin from ${account.name}?`
                          : `Grant ${account.name} super-admin across the whole platform?`
                      }
                    >
                      {account.isSuperAdmin ? 'Revoke' : 'Grant'}
                    </ConfirmButton>
                  </form>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Add to a tenant</CardTitle>
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
              Memberships
              <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">
                {activeCount} active of {memberRows.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {memberRows.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Not a member of any tenant yet. Add them to one above.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:text-slate-400">
                      <th className="px-3 py-2">Tenant</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Roles</th>
                      <th className="px-3 py-2">Joined</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {memberRows.map(({ membership, tenant }) => {
                      const roleNames = rolesByMembership.get(membership.id) ?? []
                      return (
                        <tr
                          key={membership.id}
                          className="hover:bg-slate-50/50 dark:hover:bg-slate-800/60"
                        >
                          <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                            {tenant.name}
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant={statusVariant(membership.status)}>
                              {membership.status}
                            </Badge>
                          </td>
                          <td className="px-3 py-2">
                            {roleNames.length === 0 ? (
                              <span className="text-xs text-slate-400">No roles</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {roleNames.map((n) => (
                                  <Badge key={n} variant="outline" className="text-[10px]">
                                    {n}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                            {membership.joinedAt
                              ? new Date(membership.joinedAt).toLocaleDateString()
                              : '—'}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              <form action={openMembershipInTenant}>
                                <input type="hidden" name="tenantId" value={tenant.id} />
                                <input type="hidden" name="membershipId" value={membership.id} />
                                <Button type="submit" size="sm" variant="outline">
                                  Open in tenant
                                </Button>
                              </form>
                              {membership.status === 'active' ? (
                                <form action={setMembershipStatus}>
                                  <input type="hidden" name="userId" value={account.id} />
                                  <input type="hidden" name="membershipId" value={membership.id} />
                                  <input type="hidden" name="status" value="suspended" />
                                  <Button type="submit" size="sm" variant="ghost">
                                    Suspend
                                  </Button>
                                </form>
                              ) : (
                                <form action={setMembershipStatus}>
                                  <input type="hidden" name="userId" value={account.id} />
                                  <input type="hidden" name="membershipId" value={membership.id} />
                                  <input type="hidden" name="status" value="active" />
                                  <Button type="submit" size="sm" variant="ghost">
                                    {membership.status === 'invited' ? 'Mark active' : 'Reactivate'}
                                  </Button>
                                </form>
                              )}
                              {membership.status === 'invited' ? (
                                <form action={resendInvite}>
                                  <input type="hidden" name="userId" value={account.id} />
                                  <input type="hidden" name="membershipId" value={membership.id} />
                                  <Button type="submit" size="sm" variant="ghost">
                                    Resend invite
                                  </Button>
                                </form>
                              ) : null}
                              <form action={removeMembership}>
                                <input type="hidden" name="userId" value={account.id} />
                                <input type="hidden" name="membershipId" value={membership.id} />
                                <ConfirmButton
                                  type="submit"
                                  size="sm"
                                  variant="ghost"
                                  className="text-red-600 hover:text-red-700 dark:text-red-400"
                                  confirmMessage={`Remove ${account.name} from ${tenant.name}? Their roles and permission overrides there will be deleted.`}
                                >
                                  Remove
                                </ConfirmButton>
                              </form>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
