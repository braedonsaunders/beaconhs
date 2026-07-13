// Resolve a user's effective "dashboard tier" so we can choose the right
// default widget layout. Order is descending priority — the highest tier wins
// when a user has multiple role assignments.

import { eq } from 'drizzle-orm'
import { roleAssignments, roles } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { effectiveRoleAssignments } from '@/lib/effective-role-policy'

export type RoleTier = 'super_admin' | 'tenant_admin' | 'safety_manager' | 'foreman' | 'worker'

const ROLE_TIERS: readonly RoleTier[] = [
  'super_admin',
  'tenant_admin',
  'safety_manager',
  'foreman',
  'worker',
] as const

export const TIER_RANK: Record<RoleTier, number> = {
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

function roleTierFromKey(key: string): RoleTier | null {
  return key in TIER_RANK ? (key as RoleTier) : null
}

export function inferRoleTier(role: { key: string; permissions: readonly string[] }): RoleTier {
  const keyed = roleTierFromKey(role.key)
  if (keyed) return keyed

  const permissions = new Set(role.permissions)
  if (
    [
      'admin.users.manage',
      'admin.roles.manage',
      'admin.org.manage',
      'admin.settings.manage',
      'admin.audit.read',
    ].some((p) => permissions.has(p))
  ) {
    return 'tenant_admin'
  }

  if (
    [
      'incidents.read.all',
      'ca.read.all',
      'training.read.all',
      'ppe.read.all',
      'equipment.read.all',
      'insights.read',
      'reports.read',
      'dashboards.read',
    ].some((p) => permissions.has(p))
  ) {
    return 'safety_manager'
  }

  if (
    [
      'incidents.read.site',
      'ca.read.site',
      'forms.response.read.site',
      'inspections.read.site',
      'equipment.read.site',
      'journals.read.site',
    ].some((p) => permissions.has(p))
  ) {
    return 'foreman'
  }

  return 'worker'
}

export function dashboardSourceKeyForTier(role: RoleTier): string {
  return `tier:${role}`
}

export function dashboardSourceKeyForRole(roleId: string): string {
  return `role:${roleId}`
}

/**
 * Pick the dashboard tier for this user in the active tenant.
 *
 *   • If the user is acting under one role, use that role's inferred tier.
 *   • Otherwise, prefer their highest built-in role
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
      .select({
        roleId: roles.id,
        key: roles.key,
        permissions: roles.permissions,
        isBuiltIn: roles.isBuiltIn,
      })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(eq(roleAssignments.tenantUserId, ctx.membership!.id)),
  )

  const effective = effectiveRoleAssignments(ctx.activeRoleId, rows)
  if (ctx.activeRoleId) {
    const active = effective[0]
    return active ? inferRoleTier(active) : 'worker'
  }

  let best: RoleTier | null = null
  for (const r of effective) {
    if (!r.isBuiltIn) continue
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
