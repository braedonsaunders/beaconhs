// Pure, side-effect-free helpers behind admin user-impersonation ("view as").
// The session-mutating Server Actions live in admin/users/_actions.ts
// (startImpersonation) and lib/impersonation-actions.ts (stopImpersonation);
// getRequestContext() consumes the resolution helpers here to swap the request
// onto the target user. Keeping these free of 'use server' lets both the
// request-context path and the action path reuse them.

import { and, eq } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  roleAssignments,
  roles,
  tenantUsers,
  userPermissionOverrides,
  type RoleScope,
} from '@beaconhs/db/schema'

// How long a "view as" session stays live before it auto-expires and the
// overlay collapses back to the real admin. Renewed by starting again.
export const IMPERSONATION_TTL_MS = 30 * 60 * 1000 // 30 minutes

/** Wildcard-aware permission check, mirroring @beaconhs/tenant's `can()`. */
export function permsHas(permissions: Set<string>, perm: string): boolean {
  if (permissions.has(perm)) return true
  for (const p of permissions) {
    if (p.endsWith('.*') && perm.startsWith(p.slice(0, -1))) return true
  }
  return false
}

/**
 * Resolve a membership's effective permissions + scopes: the union of its
 * roles' permissions, then per-user overrides applied grant-then-deny (deny
 * wins). This is the exact resolution getRequestContext() uses for a normal
 * login, extracted so the impersonated path produces an identical result.
 */
export async function resolveMembershipPerms(
  tx: Database,
  membershipId: string,
): Promise<{ permissions: Set<string>; scopes: RoleScope[] }> {
  const assignments = await tx
    .select({ permissions: roles.permissions, scope: roleAssignments.scope })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(eq(roleAssignments.tenantUserId, membershipId))

  const permissions = new Set<string>()
  const scopes = assignments.map((a) => a.scope)
  for (const a of assignments) for (const p of a.permissions) permissions.add(p)

  const overrides = await tx
    .select({
      permission: userPermissionOverrides.permission,
      effect: userPermissionOverrides.effect,
    })
    .from(userPermissionOverrides)
    .where(eq(userPermissionOverrides.tenantUserId, membershipId))
  for (const o of overrides) if (o.effect === 'grant') permissions.add(o.permission)
  for (const o of overrides) if (o.effect === 'deny') permissions.delete(o.permission)

  return { permissions, scopes }
}

/**
 * Re-check, on EVERY request (not just at start), that this actor may still
 * impersonate inside the pinned tenant. Super-admins always may; anyone else
 * must still be an active member of that tenant holding
 * `admin.users.impersonate`. Returning false collapses the overlay back to the
 * real actor — so a mid-session role change or suspension ends impersonation.
 */
export async function actorMayImpersonate(
  tx: Database,
  actor: { id: string; isSuperAdmin: boolean },
  pinnedTenantId: string,
): Promise<boolean> {
  if (actor.isSuperAdmin) return true
  const [m] = await tx
    .select({ id: tenantUsers.id })
    .from(tenantUsers)
    .where(
      and(
        eq(tenantUsers.userId, actor.id),
        eq(tenantUsers.tenantId, pinnedTenantId),
        eq(tenantUsers.status, 'active'),
      ),
    )
    .limit(1)
  if (!m) return false
  const { permissions } = await resolveMembershipPerms(tx, m.id)
  return permsHas(permissions, 'admin.users.impersonate')
}
