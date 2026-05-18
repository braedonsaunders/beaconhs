import { headers } from 'next/headers'
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
  makeSuperAdminContext,
  makeTenantContext,
  UnauthorizedError,
  type RequestContext,
  type SuperAdminContext,
} from '@beaconhs/tenant'

// Get the current user id from the session, or null if not signed in.
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
 * Tenant resolution order:
 *   1. The session's `activeTenantId` (set after the user picks a tenant on login)
 *   2. If the user has exactly one membership, auto-select it
 *   3. Otherwise return { tenantId: null } and the UI must route to /select-tenant
 */
export async function getRequestContext(): Promise<RequestContext | SuperAdminContext | null> {
  const headerStore = await headers()
  const session = await auth.api.getSession({ headers: headerStore })
  if (!session?.user?.id) return null

  const userId = session.user.id

  // Bypass RLS to look up user-level data
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1)
    if (!user) return null

    if (user.isSuperAdmin) {
      return makeSuperAdminContext(db, userId)
    }

    // Find tenant memberships
    const memberships = await tx
      .select({
        membership: tenantUsers,
        tenant: tenants,
      })
      .from(tenantUsers)
      .innerJoin(tenants, eq(tenants.id, tenantUsers.tenantId))
      .where(and(eq(tenantUsers.userId, userId), eq(tenantUsers.status, 'active')))

    if (memberships.length === 0) {
      return null
    }

    // Pick active tenant from session if present; else single membership
    let activeTenantId: string | undefined = (session as { activeTenantId?: string }).activeTenantId
    if (!activeTenantId && memberships.length === 1) {
      activeTenantId = memberships[0]!.tenant.id
    }
    if (!activeTenantId) return null

    const active = memberships.find((m) => m.tenant.id === activeTenantId)
    if (!active) return null

    // Load roles + permissions for this membership
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
      membership: { id: active.membership.id, displayName: active.membership.displayName ?? user.name },
      permissions,
      scopes,
    })
  })
}

export async function requireRequestContext(): Promise<RequestContext | SuperAdminContext> {
  const ctx = await getRequestContext()
  if (!ctx) throw new UnauthorizedError()
  return ctx
}
