'use server'

// The global "stop impersonating" Server Action, invoked from the persistent
// banner anywhere in the app. Kept separate from admin/users/_actions.ts so the
// banner can import it without pulling in the member-management module.

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { and, eq, sql } from 'drizzle-orm'
import { auth } from '@beaconhs/auth'
import { db } from '@beaconhs/db'
import { auditLog, sessions, tenantUsers } from '@beaconhs/db/schema'

/**
 * Stop impersonating and return to the admin's own identity. Clears the pointer
 * from the admin's real session row — which was never swapped, so this is always
 * safe and can't strand the admin — and records the stop attributed to the real
 * actor. A no-op (back to the dashboard) when not impersonating.
 */
export async function stopImpersonation(): Promise<void> {
  const authSession = await auth.api.getSession({
    headers: (await headers()) as unknown as Headers,
  })
  const token = authSession?.session?.token
  const actorUserId = authSession?.user?.id
  if (!token || !actorUserId) redirect('/dashboard')

  // Session/tenant_users/audit_log are all reachable under the bypass GUC; the
  // audit insert passes RLS WITH CHECK because bypass_rls = 'on'.
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
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
