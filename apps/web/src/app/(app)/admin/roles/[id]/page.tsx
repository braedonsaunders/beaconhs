import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { and, asc, desc, eq, notInArray } from 'drizzle-orm'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DetailHeader,
  Input,
  Label,
  TabContent,
  Textarea,
} from '@beaconhs/ui'
import {
  roleAssignments,
  roleDashboardLayouts,
  roles,
  tenantUsers,
  users as user,
  PERMISSION_CATALOGUE,
  type DashboardLayoutData,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { DetailPageLayout } from '@/components/page-layout'
import { ModuleSubNav } from '@/components/module-admin/module-sub-nav'
import { pickActiveTab } from '@/components/tab-nav'
import { isUuid, mergeHref } from '@/lib/list-params'
import { DashboardGrid } from '@/app/(app)/dashboard/_dashboard-grid'
import { loadDashboardEditCanvas } from '@/app/(app)/dashboard/_edit-canvas'
import { DEFAULT_LAYOUTS } from '@/app/(app)/dashboard/_role-defaults'
import { inferRoleTier, ROLE_TIER_LABELS } from '@/app/(app)/dashboard/_role-tier'
import { WIDGETS } from '@/app/(app)/dashboard/_widget-registry'
import {
  canPermissionSetPublishInsights,
  canPermissionSetSeeWidget,
  canPermissionSetViewInsights,
} from '@/app/(app)/dashboard/_widget-access'
import { ConfirmButton } from '@/components/confirm-button'
import { describeScope, loadScopeOptions } from '../../users/_scope-data'
import { PermissionMatrix } from '../_components/permission-matrix'
import { RoleMembersManager, type RoleMember } from '../_components/role-members-manager'
import {
  deleteRole,
  duplicateRole,
  resetRoleDashboardLayout,
  saveRoleDashboardLayout,
  saveRoleDashboardQuickActions,
  updateRoleDetails,
  updateRolePermissions,
} from '../_actions'

export const metadata = { title: 'Role' }
export const dynamic = 'force-dynamic'

const ROLE_TABS = ['details', 'permissions', 'members', 'dashboard'] as const

export default async function AdminRoleEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.roles.manage')) redirect('/admin')
  const sp = await searchParams
  const active = pickActiveTab(sp, ROLE_TABS, 'details')
  const error = typeof sp.error === 'string' ? sp.error : undefined
  const basePath = `/admin/roles/${id}`
  // Editing who holds a role is a membership change, so the members tab is only
  // editable with admin.users.manage (matching the bulk role manager); without
  // it the tab stays read-only.
  const canManageMembers = can(ctx, 'admin.users.manage')

  const data = await ctx.db(async (tx) => {
    const [role] = await tx.select().from(roles).where(eq(roles.id, id)).limit(1)
    if (!role) return null
    const members = await tx
      .select({
        membershipId: tenantUsers.id,
        assignmentId: roleAssignments.id,
        scope: roleAssignments.scope,
        name: user.name,
        email: user.email,
        displayName: tenantUsers.displayName,
        userId: tenantUsers.userId,
        isSuperAdmin: user.isSuperAdmin,
      })
      .from(roleAssignments)
      .innerJoin(tenantUsers, eq(tenantUsers.id, roleAssignments.tenantUserId))
      .innerJoin(user, eq(user.id, tenantUsers.userId))
      .where(and(eq(roleAssignments.roleId, id), eq(tenantUsers.status, 'active')))
      .orderBy(asc(user.name))
    // Active memberships that don't yet hold this role — the add picker.
    const heldIds = members.map((m) => m.membershipId)
    const candidates = canManageMembers
      ? await tx
          .select({
            membershipId: tenantUsers.id,
            name: user.name,
            email: user.email,
            displayName: tenantUsers.displayName,
            userId: tenantUsers.userId,
            isSuperAdmin: user.isSuperAdmin,
          })
          .from(tenantUsers)
          .innerJoin(user, eq(user.id, tenantUsers.userId))
          .where(
            and(
              eq(tenantUsers.status, 'active'),
              heldIds.length > 0 ? notInArray(tenantUsers.id, heldIds) : undefined,
            ),
          )
          .orderBy(asc(user.name))
      : []
    const [dashboard] = await tx
      .select({ layout: roleDashboardLayouts.layout, updatedAt: roleDashboardLayouts.updatedAt })
      .from(roleDashboardLayouts)
      .where(
        and(eq(roleDashboardLayouts.tenantId, ctx.tenantId), eq(roleDashboardLayouts.roleId, id)),
      )
      .orderBy(desc(roleDashboardLayouts.updatedAt))
      .limit(1)
    return { role, members, candidates, dashboard: dashboard ?? null }
  })
  if (!data) notFound()
  const { role, members, candidates, dashboard } = data

  // Member editing data: scope label per assignment + the addable directory.
  // describeScope/loadScopeOptions are server-only (DB-backed), so resolve them
  // here and hand the manager plain serialisable props.
  const scopeOptions = canManageMembers ? await loadScopeOptions(ctx) : null
  const memberRows: RoleMember[] = scopeOptions
    ? members.map((m) => ({
        assignmentId: m.assignmentId,
        name: m.name,
        email: m.email,
        displayName: m.displayName,
        scope: m.scope,
        scopeLabel: describeScope(m.scope, scopeOptions),
        isSelf: m.userId === ctx.userId,
        isProtectedSuperAdmin: m.isSuperAdmin && !ctx.isSuperAdmin,
      }))
    : []
  const memberCandidates =
    scopeOptions != null
      ? candidates
          .filter((c) => c.userId !== ctx.userId && (ctx.isSuperAdmin || !c.isSuperAdmin))
          .map((c) => ({
            value: c.membershipId,
            label: c.displayName ?? c.name,
            hint: c.email,
          }))
      : []
  // Remount the members manager after every membership change so its transient
  // UI state (open add panel, scope edits) resets cleanly — same rationale as
  // the permission matrix key below.
  const membersKey = members.map((m) => `${m.assignmentId}:${JSON.stringify(m.scope)}`).join('|')

  const locksTenantAdminPermissions = role.isBuiltIn && role.key === 'tenant_admin'
  const effectiveRolePermissions = locksTenantAdminPermissions
    ? [...PERMISSION_CATALOGUE]
    : role.permissions
  // Remount the permission matrix after every save. React auto-resets a
  // `<form action>` once its server action resolves, which unchecks the
  // controlled checkboxes in the DOM without re-rendering them — so the next
  // save would post a stale, partial selection. `updatedAt` bumps on each save
  // (`$onUpdate`), so keying on it rebuilds the matrix from persisted truth.
  const permissionMatrixKey = role.updatedAt.toISOString()
  const roleTier = inferRoleTier(role)
  const dashboardLayout = dashboard?.layout ?? DEFAULT_LAYOUTS[roleTier] ?? DEFAULT_LAYOUTS.worker
  const roleCanViewInsights = canPermissionSetViewInsights(effectiveRolePermissions)
  const roleCanSeeAllPublishedInsights = canPermissionSetPublishInsights(effectiveRolePermissions)
  const allowedWidgetIds = Object.keys(WIDGETS).filter((widgetId) =>
    canPermissionSetSeeWidget(effectiveRolePermissions, widgetId),
  )

  const dashboardCanvas =
    active === 'dashboard'
      ? await loadDashboardEditCanvas(ctx, dashboardLayout, {
          includeLibraryCards: roleCanViewInsights,
          filterLibraryCard: (card) =>
            card.status === 'published' &&
            (roleCanSeeAllPublishedInsights ||
              !card.allowedRoles ||
              card.allowedRoles.length === 0 ||
              card.allowedRoles.includes(role.key)),
        })
      : null

  async function saveLayout(input: { widgets: DashboardLayoutData['widgets'] }) {
    'use server'
    return saveRoleDashboardLayout({ roleId: id, widgets: input.widgets })
  }

  async function resetLayout() {
    'use server'
    return resetRoleDashboardLayout({ roleId: id })
  }

  async function saveQuickActions(input: DashboardLayoutData['quickActions']) {
    'use server'
    return saveRoleDashboardQuickActions({ roleId: id, quickActions: input ?? [] })
  }

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/admin/roles', label: 'Back to roles' }}
          title={role.name}
          subtitle={`${role.isBuiltIn ? 'Built-in role' : 'Custom role'} · ${ROLE_TIER_LABELS[roleTier]} dashboard tier`}
          badge={
            <div className="flex items-center gap-2">
              {role.isBuiltIn ? <Badge variant="secondary">Built-in</Badge> : null}
              {dashboard ? (
                <Badge variant="secondary">Dashboard configured</Badge>
              ) : (
                <Badge variant="outline">Shipped dashboard</Badge>
              )}
            </div>
          }
          actions={
            <div className="flex items-center gap-2">
              <form action={duplicateRole}>
                <input type="hidden" name="id" value={id} />
                <Button type="submit" variant="outline">
                  Duplicate
                </Button>
              </form>
              {!role.isBuiltIn ? (
                <form action={deleteRole}>
                  <input type="hidden" name="id" value={id} />
                  <ConfirmButton
                    type="submit"
                    variant="destructive"
                    message={`Delete the role "${role.name}"? This can't be undone.`}
                  >
                    Delete
                  </ConfirmButton>
                </form>
              ) : null}
            </div>
          }
        />
      }
      alerts={
        error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : null
      }
      subtabs={
        <div className="pb-2">
          <ModuleSubNav
            active={active}
            tabs={[
              {
                key: 'details',
                label: 'Details',
                href: mergeHref(basePath, sp, { tab: 'details' }),
              },
              {
                key: 'permissions',
                label: 'Permissions',
                href: mergeHref(basePath, sp, { tab: 'permissions' }),
              },
              {
                key: 'members',
                label: `Members (${members.length})`,
                href: mergeHref(basePath, sp, { tab: 'members' }),
              },
              {
                key: 'dashboard',
                label: 'Dashboard',
                href: mergeHref(basePath, sp, { tab: 'dashboard' }),
              },
            ]}
          />
        </div>
      }
      className={active === 'dashboard' ? 'max-w-none' : undefined}
    >
      <TabContent tabKey={active}>
        {active === 'details' ? (
          <form action={updateRoleDetails} className="space-y-5">
            <input type="hidden" name="id" value={id} />
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="name">
                      Name<span className="text-red-600"> *</span>
                    </Label>
                    <Input id="name" name="name" required defaultValue={role.name} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="key">Key</Label>
                    <Input id="key" value={role.key} disabled />
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Identifier used in code — can&apos;t be changed.
                    </p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    name="description"
                    rows={2}
                    defaultValue={role.description ?? ''}
                  />
                </div>
              </CardContent>
            </Card>
            <div className="flex justify-end">
              <Button type="submit">Save details</Button>
            </div>
          </form>
        ) : null}

        {active === 'permissions' ? (
          locksTenantAdminPermissions ? (
            <Card>
              <CardHeader>
                <CardTitle>Permissions</CardTitle>
                <CardDescription>
                  Tenant Admin always has the full permission catalogue and cannot be reduced.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PermissionMatrix defaultSelected={effectiveRolePermissions} readOnly />
              </CardContent>
            </Card>
          ) : (
            <form action={updateRolePermissions} className="space-y-5">
              <input type="hidden" name="id" value={id} />
              <Card>
                <CardHeader>
                  <CardTitle>Permissions</CardTitle>
                </CardHeader>
                <CardContent>
                  <PermissionMatrix
                    key={permissionMatrixKey}
                    defaultSelected={effectiveRolePermissions}
                  />
                </CardContent>
              </Card>
              <div className="flex justify-end">
                <Button type="submit">Save permissions</Button>
              </div>
            </form>
          )
        ) : null}

        {active === 'members' ? (
          <Card>
            <CardHeader>
              <CardTitle>Members with this role ({members.length})</CardTitle>
              <CardDescription>
                {canManageMembers
                  ? 'Add or remove members and set the data each one can see through this role.'
                  : 'Members who currently hold this role.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {canManageMembers && scopeOptions ? (
                <RoleMembersManager
                  key={membersKey}
                  roleId={id}
                  members={memberRows}
                  candidates={memberCandidates}
                  scopeOptions={scopeOptions}
                />
              ) : members.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No members hold this role yet.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {members.map((m) => (
                    <Link
                      key={m.membershipId}
                      href={`/admin/users/${m.membershipId}` as any}
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800/60"
                    >
                      {m.displayName ?? m.name}
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {active === 'dashboard' && dashboardCanvas ? (
          <DashboardGrid
            key={`${role.id}:${JSON.stringify(dashboardLayout.widgets)}:${JSON.stringify(
              dashboardLayout.quickActions ?? null,
            )}`}
            initialLayout={dashboardLayout}
            nodes={dashboardCanvas.nodes}
            role={roleTier}
            mode="edit"
            libraryCards={dashboardCanvas.libraryCards}
            allowedWidgetIds={allowedWidgetIds}
            saveLayoutAction={saveLayout}
            resetLayoutAction={resetLayout}
            saveRedirectHref={`${basePath}?tab=dashboard`}
            toolbarLabel={`Editing ${role.name} default`}
            resetConfirmMessage={`Reset ${role.name}'s default dashboard to the shipped ${ROLE_TIER_LABELS[roleTier]} layout?`}
            saveSuccessMessage="Role default dashboard saved"
            resetSuccessMessage="Role default dashboard reset"
            quickActionsSaveAction={saveQuickActions}
            quickActionsSaveSuccessMessage="Role default quick actions saved"
          />
        ) : null}
      </TabContent>
    </DetailPageLayout>
  )
}
