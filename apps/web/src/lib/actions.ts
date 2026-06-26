'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { db, withSuperAdmin } from '@beaconhs/db'
import { tenants, tenantUsers, users } from '@beaconhs/db/schema'
import { and, eq } from 'drizzle-orm'
import { getCurrentUserId, ACTIVE_TENANT_COOKIE } from './auth'

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

  if (tenantId === null) {
    cookieStore.delete(ACTIVE_TENANT_COOKIE)
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
  revalidatePath('/', 'layout')
  return { ok: true }
}
