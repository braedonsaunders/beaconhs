import { eq } from 'drizzle-orm'
import { type Database, withSuperAdmin, withTenant } from '@beaconhs/db'
import {
  PERMISSION_CATALOGUE,
  roleAssignments,
  roles,
  userPermissionOverrides,
  type RoleScope,
} from '@beaconhs/db/schema'

/**
 * Resolved auth + tenant context for a request. Built by the web app's
 * `getRequestContext()` helper and threaded through Server Actions / API routes.
 *
 * `tenantId` is non-null: `requireRequestContext()` redirects to login or the
 * tenant picker when no tenant is resolvable, so every consumer of this type
 * already operates inside a chosen tenant. Routes that legitimately need
 * cross-tenant access use `SuperAdminContext` instead.
 */
/**
 * Set only while an admin is "viewing as" another user. The surrounding
 * RequestContext's `userId` / `membership` / `permissions` are the IMPERSONATED
 * user's (so the whole app behaves as them); `actor` is the real admin who
 * initiated it, surfaced for the banner + dual-attribution in the audit log.
 */
export type ImpersonationInfo = {
  actor: { userId: string; name: string; email: string }
  tenantId: string
  expiresAt: Date
}

export type RequestContext = {
  userId: string
  tenantId: string
  isSuperAdmin: boolean
  // IANA timezone for the active user (e.g. 'America/Toronto'). Server components
  // render on the deploy container's clock (UTC in prod), so any local-time
  // display — greetings, "today", date headers — must format against this.
  timezone: string
  // The active tenant_user membership (id, display name)
  membership: { id: string; displayName: string } | null
  // The active user's linked person record in this tenant, resolved once at
  // request time (people.userId = this user, 1:1 per tenant). Null for accounts
  // with no employee record — super-admins, external auditors, API keys. Prefer
  // this over re-querying `people` by userId; it's the canonical "who am I as an
  // employee" for /my, record ownership, and self-scoped visibility.
  personId: string | null
  permissions: Set<string>
  scopes: RoleScope[]
  // The single role a multi-role user has "switched into" via the role
  // switcher. When set, `permissions`/`scopes` are narrowed to just that role
  // (still with per-user overrides applied). Null/undefined means the default:
  // the union of every assigned role. Never set for super-admins.
  activeRoleId?: string | null
  // Present only during impersonation — null/undefined for a normal session.
  impersonation?: ImpersonationInfo | null
  // Present for public API requests authenticated by an API key.
  apiKey?: { id: string; name: string } | null
  // Convenience: bound DB executor with tenant context applied
  db: <T>(fn: (tx: Database) => Promise<T>) => Promise<T>
}

export type SuperAdminContext = {
  userId: string
  isSuperAdmin: true
  db: <T>(fn: (tx: Database) => Promise<T>) => Promise<T>
}

export function makeTenantContext(
  baseDb: Database,
  args: Omit<RequestContext, 'db'>,
): RequestContext {
  return {
    ...args,
    db: <T>(fn: (tx: Database) => Promise<T>) => withTenant(baseDb, args.tenantId, fn),
  }
}

export function makeSuperAdminContext(baseDb: Database, userId: string): SuperAdminContext {
  return {
    userId,
    isSuperAdmin: true,
    db: <T>(fn: (tx: Database) => Promise<T>) => withSuperAdmin(baseDb, fn),
  }
}

export function can(ctx: RequestContext, perm: string): boolean {
  if (ctx.isSuperAdmin) return true
  if (ctx.permissions.has(perm)) return true
  if (readTierCovers(ctx.permissions, perm)) return true
  // wildcard convention: 'incidents.*' grants any 'incidents.x'
  for (const p of ctx.permissions) {
    if (p.endsWith('.*') && perm.startsWith(p.slice(0, -1))) return true
  }
  return false
}

export type TemplateAccessDescriptor = {
  status: 'draft' | 'published' | 'archived'
  allowedRoles: string[] | null | undefined
  deletedAt?: Date | null
}
export type TemplateAccessMode = 'operate' | 'browse-records' | 'builder-edit'
export type ResponsePayloadAccessDescriptor = {
  status: string
  locked: boolean
  submittedBy: string | null
}

export function effectiveRoleAssignments<T extends { roleId: string }>(
  activeRoleId: string | null | undefined,
  assignments: readonly T[],
): T[] {
  if (!activeRoleId) return [...assignments]
  return assignments.filter((assignment) => assignment.roleId === activeRoleId)
}

export function isTemplateBuilder(ctx: RequestContext): boolean {
  return ctx.isSuperAdmin || can(ctx, 'forms.template.create')
}

export function canAccessTemplate(
  ctx: RequestContext,
  template: TemplateAccessDescriptor,
  effectiveRoleKeys: ReadonlySet<string>,
  mode: TemplateAccessMode,
): boolean {
  if (template.deletedAt) return false
  const builder = isTemplateBuilder(ctx)
  if (mode === 'builder-edit') return builder
  if (mode === 'browse-records' && builder) return true
  if (template.status !== 'published') return false
  const allowed = template.allowedRoles
  return (
    builder ||
    !allowed ||
    allowed.length === 0 ||
    allowed.some((role) => effectiveRoleKeys.has(role))
  )
}

export function canEditResponsePayload(
  ctx: RequestContext,
  response: ResponsePayloadAccessDescriptor,
): boolean {
  if (response.locked) return false
  const isDraft = response.status === 'draft' || response.status === 'in_progress'
  const callerMembershipId = ctx.membership?.id ?? null
  const isOwner = response.submittedBy !== null && response.submittedBy === callerMembershipId
  const canWorkDraft = isDraft && can(ctx, 'forms.response.create')
  return (
    ctx.isSuperAdmin ||
    ctx.permissions.has('*') ||
    can(ctx, 'forms.response.read.all') ||
    (isOwner && (can(ctx, 'forms.response.update.own') || canWorkDraft)) ||
    (response.submittedBy === null && canWorkDraft)
  )
}

export async function resolveMembershipAccess(
  tx: Database,
  membershipId: string,
  activeRoleId?: string | null,
): Promise<{ permissions: Set<string>; scopes: RoleScope[]; appliedRoleId: string | null }> {
  const assignments = await tx
    .select({
      roleId: roleAssignments.roleId,
      permissions: roles.permissions,
      scope: roleAssignments.scope,
    })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(eq(roleAssignments.tenantUserId, membershipId))
  const appliedRoleId =
    activeRoleId && assignments.some((assignment) => assignment.roleId === activeRoleId)
      ? activeRoleId
      : null
  const effective = appliedRoleId
    ? assignments.filter((assignment) => assignment.roleId === appliedRoleId)
    : assignments
  const permissions = new Set<string>()
  const scopes = effective.map((assignment) => assignment.scope)
  for (const assignment of effective) {
    for (const permission of assignment.permissions) permissions.add(permission)
  }
  const overrides = await tx
    .select({
      permission: userPermissionOverrides.permission,
      effect: userPermissionOverrides.effect,
    })
    .from(userPermissionOverrides)
    .where(eq(userPermissionOverrides.tenantUserId, membershipId))
  for (const override of overrides) {
    if (override.effect === 'grant') permissions.add(override.permission)
  }
  applyPermissionDenies(
    permissions,
    overrides
      .filter((override) => override.effect === 'deny')
      .map((override) => override.permission),
  )
  return { permissions, scopes, appliedRoleId }
}

function applyPermissionDenies(permissions: Set<string>, denies: string[]): void {
  const specificDenies = denies.filter((deny) => !deny.endsWith('.*'))
  for (const grant of [...permissions]) {
    if (!grant.endsWith('.*')) continue
    const prefix = grant.slice(0, -1)
    if (!specificDenies.some((deny) => deny.startsWith(prefix))) continue
    permissions.delete(grant)
    for (const key of PERMISSION_CATALOGUE) if (key.startsWith(prefix)) permissions.add(key)
  }
  for (const denied of denies) {
    permissions.delete(denied)
    if (!denied.endsWith('.*')) continue
    const prefix = denied.slice(0, -1)
    for (const grant of [...permissions]) if (grant.startsWith(prefix)) permissions.delete(grant)
  }
}

function readTierCovers(permissions: Set<string>, requested: string): boolean {
  const match = /^(.+)\.read\.(all|site|self)$/.exec(requested)
  if (!match) return false
  const [, prefix, tier] = match
  if (!prefix) return false
  if (tier === 'site') return permissions.has(`${prefix}.read.all`)
  if (tier === 'self') {
    return permissions.has(`${prefix}.read.all`) || permissions.has(`${prefix}.read.site`)
  }
  return false
}

export function assertCan(ctx: RequestContext, perm: string): void {
  if (!can(ctx, perm)) {
    throw new ForbiddenError(perm)
  }
}

export class ForbiddenError extends Error {
  override readonly name = 'ForbiddenError'
  constructor(public readonly permission: string) {
    super(`Missing permission: ${permission}`)
  }
}

export class ImpersonationBlockedError extends Error {
  override readonly name = 'ImpersonationBlockedError'
  constructor(public readonly action?: string) {
    super(
      action
        ? `This action is blocked while impersonating: ${action}`
        : 'This action is blocked while impersonating another user',
    )
  }
}

/**
 * Guard for actions that must never run "as" someone else — credential/identity
 * changes, privilege grants, API-key management, bulk exports. Most admin
 * actions are already blocked because the impersonated user lacks the
 * permission; this is the explicit belt-and-suspenders for the rest.
 */
export function assertNotImpersonating(ctx: RequestContext, action?: string): void {
  if (ctx.impersonation) throw new ImpersonationBlockedError(action)
}

// Site-level scoping decision: does this ctx grant access to this site?
export function canSeeSite(ctx: RequestContext, siteId: string | null): boolean {
  if (!siteId) return true
  for (const scope of ctx.scopes) {
    if (scope.type === 'tenant') return true
    if (scope.type === 'sites' && scope.siteIds.includes(siteId)) return true
  }
  return false
}

// The single widest scope the user holds — used by older site/self gates.
// Newer record lists should prefer recordVisibilityWhere(), which unions ALL of
// the user's scopes (own + people + team + sites) rather than collapsing to one.
export function selfOnlyFilter(ctx: RequestContext): RoleScope {
  if (ctx.isSuperAdmin) return { type: 'tenant' }
  let widest: RoleScope | null = null
  const order = { tenant: 6, sites: 5, team: 4, crews: 3, people: 2, self: 1 } as const
  for (const s of ctx.scopes) {
    if (!widest || order[s.type] > order[widest.type]) widest = s
  }
  return widest ?? { type: 'self' }
}
