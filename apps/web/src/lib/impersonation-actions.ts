'use server'

// The global "stop impersonating" Server Action, invoked from the persistent
// banner anywhere in the app. Kept separate from admin/users/_actions.ts so the
// banner can import it without pulling in the member-management module.

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { getAuth } from '@beaconhs/auth'
import { db, withSuperAdmin } from '@beaconhs/db'
import { auditLog, sessions, tenantUsers } from '@beaconhs/db/schema'

/**
 * Stop impersonating and return to the admin's own identity. Clears the pointer
 * from the admin's real session row — which was never swapped, so this is always
 * safe and can't strand the admin — and records the stop attributed to the real
 * actor. A no-op (back to the dashboard) when not impersonating.
 */
export async function stopImpersonation(): Promise<void> {
  const authSession = await getAuth().api.getSession({
    headers: (await headers()) as unknown as Headers,
  })
  const token = authSession?.session?.token
  const actorUserId = authSession?.user?.id
  if (!token || !actorUserId) redirect('/dashboard')

  // Runs on the BYPASSRLS super pool: tenant_users + audit_log enforce FORCE ROW
  // LEVEL SECURITY, so the cross-tenant read and the audit insert (which would
  // otherwise fail the tenant_isolation WITH CHECK) both need the bypass role.
  const result = await withSuperAdmin(db, async (tx) => {
    const [row] = await tx
      .select({
        targetUserId: sessions.impersonatingUserId,
        tenantId: sessions.impersonationTenantId,
      })
      .from(sessions)
      .where(eq(sessions.token, token))
      .limit(1)

    await tx
      .update(sessions)
      .set({
        impersonatingUserId: null,
        impersonationTenantId: null,
        impersonationStartedAt: null,
        impersonationExpiresAt: null,
        impersonationReason: null,
      })
      .where(eq(sessions.token, token))

    if (!row?.targetUserId || !row.tenantId) return { membershipId: null as string | null }

    const [m] = await tx
      .select({ id: tenantUsers.id })
      .from(tenantUsers)
      .where(and(eq(tenantUsers.userId, row.targetUserId), eq(tenantUsers.tenantId, row.tenantId)))
      .limit(1)

    await tx.insert(auditLog).values({
      tenantId: row.tenantId,
      actorUserId,
      entityType: 'tenant_user',
      entityId: m?.id ?? null,
      action: 'impersonate_stop',
      summary: 'Stopped impersonating',
    })

    return { membershipId: m?.id ?? null }
  })

  revalidatePath('/', 'layout')
  redirect(result.membershipId ? `/admin/users/${result.membershipId}` : '/admin/users')
}
