// Resolve a user's effective "dashboard tier" so we can choose the right
// default widget layout. Order is descending priority — the highest tier wins
// when a user has multiple role assignments.

import { and, eq } from 'drizzle-orm'
import { roleAssignments, roles } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'

export type RoleTier =
  | 'super_admin'
  | 'tenant_admin'
  | 'safety_manager'
  | 'foreman'
  | 'worker'

export const ROLE_TIERS: readonly RoleTier[] = [
  'super_admin',
  'tenant_admin',
  'safety_manager',
  'foreman',
  'worker',
] as const

const TIER_RANK: Record<RoleTier, number> = {
  super_admin: 0,
  tenant_admin: 1,
  safety_manager: 2,
  foreman: 3,
  worker: 4,
}

export const ROLE_TIER_LABELS: Record<RoleTier, string> = {
  super_admin: 'Super Admin',
  tenant_admin: 'Tenant Admin',
  safety_manager: 'Safety Manager',
  foreman: 'Foreman',
  worker: 'Worker',
}

/**
 * Pick the user's highest-tier built-in role for this tenant.
 *   • super-admins always tier 'super_admin'
 *   • everyone else: scan their role_assignments, prefer the highest tier
 *   • fall back to 'worker' if nothing matches (custom-role tenants)
 */
export async function getUserRoleTier(ctx: RequestContext): Promise<RoleTier> {
  if (ctx.isSuperAdmin) return 'super_admin'
  if (!ctx.membership) return 'worker'

  const rows = await ctx.db(async (tx) =>
    tx
      .select({ key: roles.key })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(
        and(
          eq(roleAssignments.tenantUserId, ctx.membership!.id),
          eq(roles.isBuiltIn, true),
        ),
      ),
  )

  let best: RoleTier = 'worker'
  for (const r of rows) {
    const key = r.key as RoleTier
    if (key in TIER_RANK && TIER_RANK[key] < TIER_RANK[best]) best = key
  }
  return best
}
