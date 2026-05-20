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
 * Pick the dashboard tier for this user in the active tenant.
 *
 *   • If the user is a tenant member, prefer their highest built-in role
 *     (tenant_admin > safety_manager > foreman > worker). This is what
 *     drives the dashboard layout — a super-admin who is also a tenant
 *     member sees the dashboard appropriate to their tenant role, not
 *     a generic super-admin view.
 *   • If the user has no tenant_users row in this tenant (a "pure"
 *     super-admin just viewing the tenant), fall back to 'super_admin'.
 *   • If they have a membership but no built-in role assignments
 *     (custom-role-only tenants), fall back to 'worker'.
 */
export async function getUserRoleTier(ctx: RequestContext): Promise<RoleTier> {
  if (!ctx.membership) {
    return ctx.isSuperAdmin ? 'super_admin' : 'worker'
  }

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

  let best: RoleTier | null = null
  for (const r of rows) {
    const key = r.key as RoleTier
    if (key in TIER_RANK && (best === null || TIER_RANK[key] < TIER_RANK[best])) {
      best = key
    }
  }
  if (best) return best
  // Membership exists but no built-in role assignments — super-admins still
  // get the super_admin tier; everyone else falls through to worker.
  return ctx.isSuperAdmin ? 'super_admin' : 'worker'
}
