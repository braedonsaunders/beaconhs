import { type Database, withSuperAdmin, withTenant } from '@beaconhs/db'
import type { RoleScope } from '@beaconhs/db/schema'

/**
 * Resolved auth + tenant context for a request. Built by the web app's
 * `getRequestContext()` helper and threaded through Server Actions / API routes.
 *
 * `tenantId` is non-null: `requireRequestContext()` redirects to login or the
 * tenant picker when no tenant is resolvable, so every consumer of this type
 * already operates inside a chosen tenant. Routes that legitimately need
 * cross-tenant access use `SuperAdminContext` instead.
 */
export type RequestContext = {
  userId: string
  tenantId: string
  isSuperAdmin: boolean
  // The active tenant_user membership (id, display name)
  membership: { id: string; displayName: string } | null
  permissions: Set<string>
  scopes: RoleScope[]
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
  // wildcard convention: 'incidents.*' grants any 'incidents.x'
  for (const p of ctx.permissions) {
    if (p.endsWith('.*') && perm.startsWith(p.slice(0, -1))) return true
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

export class UnauthorizedError extends Error {
  override readonly name = 'UnauthorizedError'
  constructor(message = 'Not signed in') {
    super(message)
  }
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
