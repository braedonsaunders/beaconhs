import { cookies, headers } from 'next/headers'
import { auth } from '@beaconhs/auth'
import { db } from '@beaconhs/db'
import {
  roleAssignments,
  roles,
  tenants,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import {
  makeTenantContext,
  UnauthorizedError,
  type RequestContext,
} from '@beaconhs/tenant'

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
 * Build the RequestContext for the active tenant.
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
export async function getRequestContext(): Promise<RequestContext | null> {
  const headerStore = await headers()
  const session = await auth.api.getSession({ headers: headerStore })
  if (!session?.user?.id) return null

  const userId = session.user.id
  const cookieStore = await cookies()
  const cookieTenantId = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value ?? null

  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    const [u] = await tx.select().from(users).where(eq(users.id, userId)).limit(1)
    if (!u) return null

    if (u.isSuperAdmin) {
      // Find which tenant to view
      let tenantId = cookieTenantId
      if (!tenantId) {
        const allTenants = await tx.select({ id: tenants.id }).from(tenants).limit(2)
        if (allTenants.length === 1) tenantId = allTenants[0]!.id
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
        membership: m
          ? { id: m.id, displayName: m.displayName ?? u.name }
          : null,
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

    if (memberships.length === 0) return null

    let active = cookieTenantId
      ? memberships.find((m) => m.tenant.id === cookieTenantId)
      : undefined
    if (!active && memberships.length === 1) active = memberships[0]
    if (!active) return null

    const assignments = await tx
      .select({ assignment: roleAssignments, role: roles })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(eq(roleAssignments.tenantUserId, active.membership.id))

    const permissions = new Set<string>()
    const scopes = assignments.map((a) => a.assignment.scope)
    for (const a of assignments) for (const p of a.role.permissions) permissions.add(p)

    return makeTenantContext(db, {
      userId,
      tenantId: active.tenant.id,
      isSuperAdmin: false,
      membership: {
        id: active.membership.id,
        displayName: active.membership.displayName ?? u.name,
      },
      permissions,
      scopes,
    })
  })
}

export async function requireRequestContext(): Promise<RequestContext> {
  const ctx = await getRequestContext()
  if (!ctx) throw new UnauthorizedError()
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
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
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
