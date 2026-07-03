// Pure, side-effect-free helpers behind admin user-impersonation ("view as").
// The session-mutating Server Actions live in admin/users/_actions.ts
// (startImpersonation) and lib/impersonation-actions.ts (stopImpersonation);
// getRequestContext() consumes the resolution helpers here to swap the request
// onto the target user. Keeping these free of 'use server' lets both the
// request-context path and the action path reuse them.

import { and, eq } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  PERMISSION_CATALOGUE,
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
 *
 * When `activeRoleId` is supplied AND the membership still holds that role, the
 * resolution narrows to just that one role's permissions + scopes (the user has
 * "switched into" a single role via the role switcher). A stale/unknown role id
 * falls back to the full union. Per-user overrides always apply on top — they
 * are membership-level, not role-level. `appliedRoleId` reports which role the
 * narrowing actually used (null when the union was used).
 */
export async function resolveMembershipPerms(
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

  // Narrow to the switched-into role only when it is actually one of this
  // membership's roles; otherwise use every assigned role (the default union).
  const appliedRoleId =
    activeRoleId && assignments.some((a) => a.roleId === activeRoleId) ? activeRoleId : null
  const effective = appliedRoleId
    ? assignments.filter((a) => a.roleId === appliedRoleId)
    : assignments

  const permissions = new Set<string>()
  const scopes = effective.map((a) => a.scope)
  for (const a of effective) for (const p of a.permissions) permissions.add(p)

  const overrides = await tx
    .select({
      permission: userPermissionOverrides.permission,
      effect: userPermissionOverrides.effect,
    })
    .from(userPermissionOverrides)
    .where(eq(userPermissionOverrides.tenantUserId, membershipId))
  for (const o of overrides) if (o.effect === 'grant') permissions.add(o.permission)
  applyDenyOverrides(
    permissions,
    overrides.filter((o) => o.effect === 'deny').map((o) => o.permission),
  )

  return { permissions, scopes, appliedRoleId }
}

/**
 * Apply deny overrides to a resolved grant set, wildcard-aware in BOTH
 * directions so `can()` (which honours the `module.*` convention) cannot
 * resurrect a denied permission:
 *  - a wildcard deny (`incidents.*`) revokes every grant under its prefix;
 *  - a specific deny that a wildcard grant covers first expands that grant to
 *    the catalogue keys under its prefix, then removes the denied key.
 * Note: tier implication in `can()` (`x.read.all` covers `x.read.self`) is not
 * unwound here — denying a lower read tier while a higher one is granted keeps
 * the higher tier intact.
 */
function applyDenyOverrides(permissions: Set<string>, denies: string[]): void {
  if (denies.length === 0) return

  const specificDenies = denies.filter((d) => !d.endsWith('.*'))
  for (const grant of [...permissions]) {
    if (!grant.endsWith('.*')) continue
    const prefix = grant.slice(0, -1)
    if (!specificDenies.some((d) => d.startsWith(prefix))) continue
    permissions.delete(grant)
    for (const key of PERMISSION_CATALOGUE) if (key.startsWith(prefix)) permissions.add(key)
  }

  for (const denied of denies) {
    permissions.delete(denied)
    if (denied.endsWith('.*')) {
      const prefix = denied.slice(0, -1)
      for (const grant of [...permissions]) if (grant.startsWith(prefix)) permissions.delete(grant)
    }
  }
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
