'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { db, withSuperAdmin } from '@beaconhs/db'
import { roleAssignments, tenants, tenantUsers, users } from '@beaconhs/db/schema'
import { and, eq } from 'drizzle-orm'
import {
  getCurrentUserId,
  getRequestContext,
  ACTIVE_TENANT_COOKIE,
  ACTIVE_ROLE_COOKIE,
} from './auth'

/**
 * Set (or clear) the active tenant cookie.
 * - super-admin can switch to any tenant
 * - regular user can only switch to tenants they're a member of
 */
export async function setActiveTenant(
  tenantId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const userId = await getCurrentUserId()
  if (!userId) return { ok: false, error: 'Not signed in' }

  const cookieStore = await cookies()

  // Switching tenants always resets the active role: a role id only resolves
  // inside the membership it belongs to, so it must not leak across tenants.
  if (tenantId === null) {
    cookieStore.delete(ACTIVE_TENANT_COOKIE)
    cookieStore.delete(ACTIVE_ROLE_COOKIE)
    revalidatePath('/', 'layout')
    return { ok: true }
  }

  // Cross-tenant membership check before switching scope — runs on the BYPASSRLS
  // super pool because tenant_users enforces FORCE ROW LEVEL SECURITY.
  const allowed = await withSuperAdmin(db, async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId)).limit(1)
    if (!u) return false
    if (u.isSuperAdmin) {
      const [t] = await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)
      return !!t
    }
    const [m] = await tx
      .select({ id: tenantUsers.id })
      .from(tenantUsers)
      .where(
        and(
          eq(tenantUsers.userId, userId),
          eq(tenantUsers.tenantId, tenantId),
          eq(tenantUsers.status, 'active'),
        ),
      )
      .limit(1)
    return !!m
  })

  if (!allowed) return { ok: false, error: 'You are not a member of that tenant' }

  cookieStore.set(ACTIVE_TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  cookieStore.delete(ACTIVE_ROLE_COOKIE)
  revalidatePath('/', 'layout')
  return { ok: true }
}

/**
 * Set (or clear) the active role for a multi-role user. Clearing (null) returns
 * to the default: the union of every assigned role. Setting narrows the whole
 * session — permissions AND scopes — to just that one role, letting a user who
 * wears several hats act under one at a time. Super-admins don't role-switch.
 */
export async function setActiveRole(
  roleId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getRequestContext()
  if (!ctx) return { ok: false, error: 'Not signed in' }
  if (ctx.isSuperAdmin) return { ok: false, error: 'Super-admins do not switch roles' }
  if (ctx.impersonation) return { ok: false, error: 'Cannot switch roles while impersonating' }
  if (!ctx.membership) return { ok: false, error: 'No membership in the active tenant' }

  const cookieStore = await cookies()

  if (roleId === null) {
    cookieStore.delete(ACTIVE_ROLE_COOKIE)
    revalidatePath('/', 'layout')
    return { ok: true }
  }

  // Only allow switching into a role actually assigned to this membership.
  // ctx.db is tenant-scoped, so RLS already bounds this to the active tenant.
  const membershipId = ctx.membership.id
  const allowed = await ctx.db(async (tx) => {
    const [r] = await tx
      .select({ id: roleAssignments.id })
      .from(roleAssignments)
      .where(
        and(eq(roleAssignments.tenantUserId, membershipId), eq(roleAssignments.roleId, roleId)),
      )
      .limit(1)
    return !!r
  })
  if (!allowed) return { ok: false, error: 'That role is not assigned to you' }

  cookieStore.set(ACTIVE_ROLE_COOKIE, roleId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  revalidatePath('/', 'layout')
  return { ok: true }
}
