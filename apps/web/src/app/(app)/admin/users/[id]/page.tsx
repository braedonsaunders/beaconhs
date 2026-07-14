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
  cn,
} from '@beaconhs/ui'
import {
  roleAssignments,
  roles,
  tenantUsers,
  users as user,
  userPermissionOverrides,
  type RoleScope,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { isUuid } from '@/lib/list-params'
import { formatDate } from '@/lib/datetime'
import { recentActivityForEntity } from '@/lib/audit'
import { ActivityFeed } from '@/components/activity-feed'
import { PageContainer } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { PERMISSION_GROUPS, permissionLabel } from '@/lib/permissions-meta'
import { PersonSelectField } from '@/components/person-select-field'
import { ScopePicker } from '../_components/scope-picker'
import { ConfirmButton } from '@/components/confirm-button'
import { loadScopeOptions, describeScope } from '../_scope-data'
import {
  assignRole,
  clearPermissionOverride,
  loadPersonLinkData,
  removeAssignment,
  removeMember,
  resendInvite,
  setMemberStatus,
  setPermissionOverride,
  setUserPersonLink,
  startImpersonation,
  updateMemberDisplayName,
} from '../_actions'

export const metadata = { title: 'Member' }
export const dynamic = 'force-dynamic'

const TABS = ['overview', 'roles', 'permissions', 'activity'] as const

export default async function AdminUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.users.manage')) redirect('/admin')
  const sp = await searchParams
  const active = pickActiveTab(sp, TABS, 'overview')
  const error = typeof sp.error === 'string' ? sp.error : undefined
  const notice = typeof sp.notice === 'string' ? sp.notice : undefined

  const data = await ctx.db(async (tx) => {
    const [member] = await tx
      .select({ membership: tenantUsers, account: user })
      .from(tenantUsers)
      .innerJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(tenantUsers.id, id))
      .limit(1)
    if (!member) return null
    const assignments = await tx
      .select({ assignment: roleAssignments, role: roles })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(eq(roleAssignments.tenantUserId, id))
    const allRoles = await tx
      .select({ id: roles.id, name: roles.name, permissions: roles.permissions })
      .from(roles)
      .orderBy(asc(roles.name))
    const overrides = await tx
      .select({
        permission: userPermissionOverrides.permission,
        effect: userPermissionOverrides.effect,
      })
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.tenantUserId, id))
    return { member, assignments, allRoles, overrides }
  })

  if (!data) notFound()
  const { member, assignments, allRoles, overrides } = data
  const scopeOptions = await loadScopeOptions(ctx)
  const personLink = await loadPersonLinkData(ctx, member.account.id)
  const activity = await recentActivityForEntity(ctx, 'tenant_user', id)

  const displayName = member.membership.displayName ?? member.account.name
  const canEditPersonLink = ctx.isSuperAdmin || !member.account.isSuperAdmin
  // "View as": needs the impersonate permission, an active non-super-admin
  // target that isn't yourself, and that you're not already impersonating.
  const canImpersonate =
    can(ctx, 'admin.users.impersonate') &&
    !ctx.impersonation &&
    member.membership.userId !== ctx.userId &&
    !member.account.isSuperAdmin &&
    member.membership.status === 'active'

  // Effective permissions: union of assigned roles' permissions, then overrides.
  const rolePerms = new Set<string>()
  for (const a of assignments) for (const p of a.role.permissions) rolePerms.add(p)
  const overrideMap = new Map(overrides.map((o) => [o.permission, o.effect] as const))

  const basePath = `/admin/users/${id}`

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/admin/users', label: 'Back to users' }}
          title={displayName}
          subtitle={member.account.email}
          badge={
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  member.membership.status === 'active'
                    ? 'success'
                    : member.membership.status === 'invited'
                      ? 'secondary'
                      : 'destructive'
                }
              >
                {member.membership.status}
              </Badge>
              {member.account.isSuperAdmin ? <Badge variant="warning">super-admin</Badge> : null}
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

        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'roles', label: 'Roles & scope', count: assignments.length },
            { key: 'permissions', label: 'Permissions' },
            { key: 'activity', label: 'Activity' },
          ]}
        />

        {active === 'overview' ? (
          <div className="space-y-5">
            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Profile</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
                    <dt className="text-slate-500 dark:text-slate-400">Account name</dt>
                    <dd className="col-span-2 text-slate-900 dark:text-slate-100">
                      {member.account.name}
                    </dd>
                    <dt className="text-slate-500 dark:text-slate-400">Email</dt>
                    <dd className="col-span-2 text-slate-900 dark:text-slate-100">
                      {member.account.email}
                    </dd>
                    <dt className="text-slate-500 dark:text-slate-400">Joined</dt>
                    <dd className="col-span-2 text-slate-900 dark:text-slate-100">
                      {member.membership.joinedAt
                        ? formatDate(new Date(member.membership.joinedAt), ctx.timezone, ctx.locale)
                        : '—'}
                    </dd>
                  </dl>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Account identity and passwords are managed by the member from{' '}
                    <strong>Account settings</strong>. Platform super-admins manage global identity
                    from the Platform area.
                  </p>
                  <form action={updateMemberDisplayName} className="space-y-1.5">
                    <input type="hidden" name="membershipId" value={id} />
                    <Label htmlFor="displayName">Display name in this tenant</Label>
                    <div className="flex gap-2">
                      <Input
                        id="displayName"
                        name="displayName"
                        defaultValue={member.membership.displayName ?? ''}
                        placeholder={member.account.name}
                      />
                      <Button type="submit" variant="outline">
                        Save
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Status & access</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {member.membership.status === 'active' ? (
                      <form action={setMemberStatus}>
                        <input type="hidden" name="membershipId" value={id} />
                        <input type="hidden" name="status" value="suspended" />
                        <Button type="submit" variant="outline">
                          Suspend member
                        </Button>
                      </form>
                    ) : member.membership.status === 'suspended' ? (
                      <form action={setMemberStatus}>
                        <input type="hidden" name="membershipId" value={id} />
                        <input type="hidden" name="status" value="active" />
                        <Button type="submit" variant="outline">
                          Reactivate
                        </Button>
                      </form>
                    ) : null}
                    {member.membership.status === 'invited' ? (
                      <form action={resendInvite}>
                        <input type="hidden" name="membershipId" value={id} />
                        <Button type="submit" variant="ghost">
                          Resend invite
                        </Button>
                      </form>
                    ) : null}
                    <form action={removeMember}>
                      <input type="hidden" name="membershipId" value={id} />
                      <ConfirmButton
                        type="submit"
                        variant="destructive"
                        message={`Remove ${displayName} from this tenant? Their roles and permission overrides here will be deleted.`}
                      >
                        Remove from tenant
                      </ConfirmButton>
                    </form>
                  </div>

                  {canImpersonate ? (
                    <div className="rounded-md border border-rose-200 p-3 dark:border-rose-900/60">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                            Impersonate
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            See the app exactly as {displayName}. Anything you do is recorded
                            against you and ends after 30 minutes or when you exit.
                          </p>
                        </div>
                        <form action={startImpersonation}>
                          <input type="hidden" name="membershipId" value={id} />
                          <ConfirmButton
                            type="submit"
                            variant="outline"
                            message={`View the app as ${displayName}? You'll act on their behalf until you exit, and everything you do is audited.`}
                          >
                            View as user
                          </ConfirmButton>
                        </form>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Person record</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Link this account to an employee record so their training, compliance, and
                  self-service pages resolve to the right person. Each account maps to at most one
                  person in this tenant.
                </p>
                {canEditPersonLink ? (
                  <form action={setUserPersonLink} className="space-y-3">
                    <input type="hidden" name="membershipId" value={id} />
                    <div className="space-y-1.5">
                      <Label htmlFor="personId">Linked person</Label>
                      <PersonSelectField
                        name="personId"
                        defaultValue={personLink.linked?.id ?? ''}
                        options={personLink.options.map((p) => ({
                          value: p.id,
                          label: p.name,
                          hint: p.hint ?? undefined,
                        }))}
                        placeholder="No linked person"
                        emptyLabel="No linked person"
                      />
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Only active people not already tied to another account are listed.
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      {personLink.linked ? (
                        <a
                          href={`/people/${personLink.linked.id}`}
                          className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
                        >
                          Open {personLink.linked.name} →
                        </a>
                      ) : (
                        <span />
                      )}
                      <Button type="submit" variant="outline">
                        Save
                      </Button>
                    </div>
                  </form>
                ) : (
                  <p className="text-sm text-slate-700 dark:text-slate-200">
                    {personLink.linked ? (
                      <a
                        href={`/people/${personLink.linked.id}`}
                        className="font-medium text-teal-700 hover:underline dark:text-teal-400"
                      >
                        {personLink.linked.name}
                      </a>
                    ) : (
                      'No linked person record.'
                    )}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        ) : null}

        {active === 'roles' ? (
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>Assigned roles</CardTitle>
              </CardHeader>
              <CardContent>
                {assignments.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    No roles yet. Add one below — without a role this member can only sign in.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {assignments.map((a) => (
                      <li
                        key={a.assignment.id}
                        className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {a.role.name}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {describeScope(a.assignment.scope as RoleScope, scopeOptions)}
                          </div>
                        </div>
                        <form action={removeAssignment}>
                          <input type="hidden" name="membershipId" value={id} />
                          <input type="hidden" name="assignmentId" value={a.assignment.id} />
                          <Button type="submit" variant="ghost" size="sm">
                            Remove
                          </Button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Add or update a role</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={assignRole} className="space-y-4">
                  <input type="hidden" name="membershipId" value={id} />
                  <div className="space-y-1.5">
                    <Label htmlFor="roleId">Role</Label>
                    <Select id="roleId" name="roleId" required defaultValue="">
                      <option value="" disabled>
                        Select a role…
                      </option>
                      {allRoles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </Select>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Re-selecting a role the member already holds updates its scope.
                    </p>
                  </div>
                  <ScopePicker
                    sites={scopeOptions.sites}
                    crews={scopeOptions.crews}
                    departments={scopeOptions.departments}
                    groups={scopeOptions.groups}
                    people={scopeOptions.people}
                  />
                  <div className="flex justify-end">
                    <Button type="submit">Save role</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {active === 'permissions' ? (
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>Overrides</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Grant a permission this member&apos;s roles don&apos;t include, or deny one they
                  do. Denials win over everything.
                </p>
                <form action={setPermissionOverride} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="membershipId" value={id} />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Label htmlFor="permission">Permission</Label>
                    <Select id="permission" name="permission" required defaultValue="">
                      <option value="" disabled>
                        Select a permission…
                      </option>
                      {PERMISSION_GROUPS.map((g) => (
                        <optgroup key={g.key} label={g.label}>
                          {g.permissions.map((p) => (
                            <option key={p.key} value={p.key}>
                              {p.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="effect">Effect</Label>
                    <Select id="effect" name="effect" defaultValue="grant" className="w-32">
                      <option value="grant">Grant</option>
                      <option value="deny">Deny</option>
                    </Select>
                  </div>
                  <Button type="submit">Apply</Button>
                </form>

                {overrides.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {overrides.map((o) => (
                      <span
                        key={o.permission}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full py-1 pr-1 pl-2.5 text-xs font-medium',
                          o.effect === 'grant'
                            ? 'bg-teal-50 text-teal-800 dark:bg-teal-950/50 dark:text-teal-300'
                            : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
                        )}
                      >
                        {o.effect === 'grant' ? '＋' : '−'} {permissionLabel(o.permission)}
                        <form action={clearPermissionOverride}>
                          <input type="hidden" name="membershipId" value={id} />
                          <input type="hidden" name="permission" value={o.permission} />
                          <button
                            type="submit"
                            aria-label={`Clear override ${permissionLabel(o.permission)}`}
                            className="rounded-full px-1 hover:bg-black/5 dark:hover:bg-white/10"
                          >
                            ✕
                          </button>
                        </form>
                      </span>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Effective permissions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {PERMISSION_GROUPS.map((g) => (
                  <div key={g.key} className="space-y-2">
                    <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
                      {g.label}
                    </h3>
                    <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                      {g.permissions.map((p) => {
                        const ov = overrideMap.get(p.key)
                        const effective =
                          ov === 'deny' ? false : ov === 'grant' ? true : rolePerms.has(p.key)
                        return (
                          <li
                            key={p.key}
                            className="flex items-center justify-between gap-2 py-0.5 text-sm"
                          >
                            <span
                              className={cn(
                                effective
                                  ? 'text-slate-700 dark:text-slate-200'
                                  : 'text-slate-400 dark:text-slate-500',
                              )}
                            >
                              {p.label}
                            </span>
                            <PermissionState inRole={rolePerms.has(p.key)} override={ov} />
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        ) : null}

        {active === 'activity' ? (
          <ActivityFeed entries={activity} timeZone={ctx.timezone} locale={ctx.locale} />
        ) : null}
      </div>
    </PageContainer>
  )
}

function PermissionState({
  inRole,
  override,
}: {
  inRole: boolean
  override: 'grant' | 'deny' | undefined
}) {
  if (override === 'deny')
    return (
      <Badge variant="destructive" className="text-[10px]">
        Denied
      </Badge>
    )
  if (override === 'grant')
    return (
      <Badge variant="success" className="text-[10px]">
        Granted · override
      </Badge>
    )
  if (inRole)
    return (
      <Badge variant="secondary" className="text-[10px]">
        Granted · role
      </Badge>
    )
  return <span className="text-[10px] text-slate-300 dark:text-slate-600">—</span>
}
