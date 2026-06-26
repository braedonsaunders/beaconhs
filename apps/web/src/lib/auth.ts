import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { auth } from '@beaconhs/auth'
import { db, withSuperAdmin, type Database } from '@beaconhs/db'
import { sessions, tenants, tenantUsers, users } from '@beaconhs/db/schema'
import { and, asc, eq, sql } from 'drizzle-orm'
import {
  assertNotImpersonating,
  makeTenantContext,
  UnauthorizedError,
  type RequestContext,
} from '@beaconhs/tenant'
import { actorMayImpersonate, resolveMembershipPerms } from './impersonation'

export const ACTIVE_TENANT_COOKIE = 'bhs-active-tenant'

export async function getCurrentUserId(): Promise<string | null> {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    return session?.user?.id ?? null
  } catch {
    return null
  }
}

export async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId()
  if (!userId) throw new UnauthorizedError()
  return userId
}

/**
 * The real signed-in user's display name + email, straight from the Better-Auth
 * session. Unlike RequestContext (which carries the EFFECTIVE / impersonated
 * identity), this is always the actual account — used by the top-bar account menu.
 */
export async function getSessionUser(): Promise<{ name: string; email: string } | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null
  return { name: session.user.name ?? '', email: session.user.email ?? '' }
}

/**
 * Build the RequestContext for the active tenant. Memoized per request via
 * React cache() — the (app) layout, the page, and shared chrome (ModuleNav)
 * all call this, but the session + role lookup runs once per render pass.
 *
 * Super-admin resolution:
 *   1. If `bhs-active-tenant` cookie set, view-as that tenant
 *   2. Else if exactly one tenant exists in the DB, auto-pick it
 *   3. Else return null and let the caller show a tenant picker
 *
 * Regular user resolution:
 *   1. If cookie set AND user is a member, use that
 *   2. Else if exactly one membership, auto-pick it
 *   3. Else null
 *
 * Either way, the returned context's `db()` helper scopes queries to that
 * tenant. Super-admin keeps `isSuperAdmin: true` for permission checks but
 * data is still tenant-bounded (so the UI feels like that tenant's session).
 */
export const getRequestContext = cache(async (): Promise<RequestContext | null> => {
  const headerStore = await headers()
  const session = await auth.api.getSession({ headers: headerStore })
  if (!session?.user?.id) return null

  const userId = session.user.id
  // The real session's token keys the impersonation pointer (stored on the
  // admin's own session row). The Better-Auth session cookie is never swapped,
  // so this stays the admin's token throughout — "stop" just clears the pointer.
  const sessionToken = session.session?.token ?? null
  const cookieStore = await cookies()
  const cookieTenantId = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value ?? null

  // Bootstrap read: resolve identity + membership ACROSS tenants before any
  // tenant scope is chosen. Runs on the BYPASSRLS super pool — the tenant tables
  // (tenant_users, roles, …) enforce FORCE ROW LEVEL SECURITY, so a normal
  // connection would see zero rows here. The returned context's db() helper is
  // still tenant-scoped via makeTenantContext.
  return await withSuperAdmin(db, async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId)).limit(1)
    if (!u) return null

    // Impersonation overlay: when this admin session is "viewing as" another
    // user, resolve the WHOLE request as the target (their tenant, their real
    // permissions + scopes), remembering the real actor. Re-authorized here on
    // every request; any failure falls through to the admin's own context.
    if (sessionToken) {
      const overlay = await resolveImpersonation(tx as unknown as Database, sessionToken, u)
      if (overlay) return overlay
    }

    if (u.isSuperAdmin) {
      // Find which tenant to view
      let tenantId = cookieTenantId
      if (!tenantId) {
        // No active-tenant cookie yet (e.g. first login). Default to a tenant
        // the super-admin belongs to, else the oldest tenant. We must NOT
        // return null while tenants exist: the (app) layout treats a null
        // context as "logged out" and redirects to /login, which then redirects
        // a logged-in user back to /dashboard → infinite redirect loop.
        const [pick] = await tx
          .select({ id: tenants.id })
          .from(tenants)
          .leftJoin(
            tenantUsers,
            and(
              eq(tenantUsers.tenantId, tenants.id),
              eq(tenantUsers.userId, userId),
              eq(tenantUsers.status, 'active'),
            ),
          )
          .orderBy(sql`(${tenantUsers.id} is null)`, tenants.createdAt)
          .limit(1)
        tenantId = pick?.id ?? null
      }
      if (!tenantId) return null

      // Verify tenant exists
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1)
      if (!t) return null

      // Super-admin has all permissions; no scoping. But they can ALSO have a
      // tenant_users row in the active tenant — in which case we attach that
      // membership so per-user features (saved dashboard layout, personal
      // notifications, etc.) work the same as for a regular user.
      const [m] = await tx
        .select()
        .from(tenantUsers)
        .where(
          and(
            eq(tenantUsers.userId, userId),
            eq(tenantUsers.tenantId, t.id),
            eq(tenantUsers.status, 'active'),
          ),
        )
        .limit(1)
      const permissions = new Set<string>(['*'])
      return makeTenantContext(db, {
        userId,
        tenantId: t.id,
        isSuperAdmin: true,
        timezone: u.timezone,
        membership: m ? { id: m.id, displayName: m.displayName ?? u.name } : null,
        permissions,
        scopes: [{ type: 'tenant' }],
      })
    }

    // Regular user
    const memberships = await tx
      .select({ membership: tenantUsers, tenant: tenants })
      .from(tenantUsers)
      .innerJoin(tenants, eq(tenants.id, tenantUsers.tenantId))
      .where(and(eq(tenantUsers.userId, userId), eq(tenantUsers.status, 'active')))
      // Deterministic order so a multi-tenant user defaults to a STABLE tenant (their oldest /
      // "home" membership) across requests — not a random one that flips per query.
      .orderBy(asc(tenantUsers.joinedAt))

    if (memberships.length === 0) return null

    let active = cookieTenantId
      ? memberships.find((m) => m.tenant.id === cookieTenantId)
      : undefined
    // No cookie (or it points at a tenant they're no longer in) → fall back to their first membership.
    // A user can belong to several tenants (one global identity, joined by email), so we must NOT bail
    // out here — returning null when there are multiple memberships caused a /login ↔ /dashboard redirect
    // loop (the layout has a session but no context). The active tenant is switchable in the UI.
    if (!active) active = memberships[0]
    if (!active) return null

    // Role-union permissions + scopes, then per-user grant/deny overrides
    // (deny wins). Shared with the impersonation path so both resolve identically.
    const { permissions, scopes } = await resolveMembershipPerms(
      tx as unknown as Database,
      active.membership.id,
    )

    return makeTenantContext(db, {
      userId,
      tenantId: active.tenant.id,
      isSuperAdmin: false,
      timezone: u.timezone,
      membership: {
        id: active.membership.id,
        displayName: active.membership.displayName ?? u.name,
      },
      permissions,
      scopes,
    })
  })
})

/**
 * Resolve the impersonation overlay for an admin session that is "viewing as"
 * another user. Returns the target user's RequestContext (pinned to the tenant
 * impersonation was started in, carrying the target's real permissions/scopes
 * and the real actor in `impersonation`), or null when there is no active,
 * still-authorized pointer — in which case the caller resolves the admin's own
 * context. Runs inside the bypass-RLS read transaction from getRequestContext.
 */
async function resolveImpersonation(
  tx: Database,
  sessionToken: string,
  actor: { id: string; name: string; email: string; isSuperAdmin: boolean },
): Promise<RequestContext | null> {
  const [s] = await tx
    .select({
      targetUserId: sessions.impersonatingUserId,
      tenantId: sessions.impersonationTenantId,
      expiresAt: sessions.impersonationExpiresAt,
    })
    .from(sessions)
    .where(eq(sessions.token, sessionToken))
    .limit(1)
  if (!s?.targetUserId || !s.tenantId || !s.expiresAt) return null
  if (s.expiresAt.getTime() <= Date.now()) return null

  // Re-authorize the real actor for the pinned tenant on EVERY request, so a
  // mid-session role change / suspension immediately ends the impersonation.
  if (!(await actorMayImpersonate(tx, actor, s.tenantId))) return null

  // Super-admins are never impersonatable — their real experience is the
  // cross-tenant bypass we deliberately refuse to grant through this path.
  const [target] = await tx.select().from(users).where(eq(users.id, s.targetUserId)).limit(1)
  if (!target || target.isSuperAdmin) return null

  // The target must still be an active member of the pinned tenant.
  const [m] = await tx
    .select({ id: tenantUsers.id, displayName: tenantUsers.displayName })
    .from(tenantUsers)
    .where(
      and(
        eq(tenantUsers.userId, target.id),
        eq(tenantUsers.tenantId, s.tenantId),
        eq(tenantUsers.status, 'active'),
      ),
    )
    .limit(1)
  if (!m) return null

  const { permissions, scopes } = await resolveMembershipPerms(tx, m.id)
  return makeTenantContext(db, {
    userId: target.id,
    tenantId: s.tenantId,
    isSuperAdmin: false,
    timezone: target.timezone,
    membership: { id: m.id, displayName: m.displayName ?? target.name },
    permissions,
    scopes,
    impersonation: {
      // Fall back to email so the banner never reads "signed in as ⟨blank⟩"
      // for an actor whose account has no display name set.
      actor: { userId: actor.id, name: actor.name || actor.email, email: actor.email },
      tenantId: s.tenantId,
      expiresAt: s.expiresAt,
    },
  })
}

export async function requireRequestContext(): Promise<RequestContext> {
  const ctx = await getRequestContext()
  if (!ctx) throw new UnauthorizedError()
  return ctx
}

/**
 * Like requireRequestContext, but refuses while impersonating: bulk data
 * exports must never run "as" another user (they'd exfiltrate that user's data
 * under the admin's hand without a per-record audit). Used by the export.csv
 * routes — the rest of the app stays read+write under impersonation.
 */
export async function requireExportContext(): Promise<RequestContext> {
  const ctx = await requireRequestContext()
  assertNotImpersonating(ctx, 'export')
  return ctx
}

/**
 * List the tenants the current user can switch to.
 *   - super-admin sees all tenants
 *   - regular user sees their memberships
 */
export async function listAccessibleTenants(): Promise<
  { id: string; name: string; slug: string }[]
> {
  const userId = await getCurrentUserId()
  if (!userId) return []
  return await withSuperAdmin(db, async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId)).limit(1)
    if (!u) return []
    if (u.isSuperAdmin) {
      const rows = await tx
        .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
        .from(tenants)
        .orderBy(tenants.name)
      return rows
    }
    return await tx
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
      .from(tenants)
      .innerJoin(tenantUsers, eq(tenantUsers.tenantId, tenants.id))
      .where(and(eq(tenantUsers.userId, userId), eq(tenantUsers.status, 'active')))
      .orderBy(tenants.name)
  })
}
