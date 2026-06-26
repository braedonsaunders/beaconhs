// Load the active dashboard layout for the current user.
// Falls back to the role default if the user hasn't customised.

import { and, eq } from 'drizzle-orm'
import {
  roleAssignments,
  roleDashboardLayouts,
  roles,
  userDashboardLayouts,
  type DashboardLayoutData,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { DEFAULT_LAYOUTS } from './_role-defaults'
import {
  dashboardSourceKeyForRole,
  dashboardSourceKeyForTier,
  getUserRoleTier,
  inferRoleTier,
  TIER_RANK,
  type RoleTier,
} from './_role-tier'

type DashboardDefault = {
  layout: DashboardLayoutData
  sourceKey: string
}

async function loadAssignedRoleDefault(ctx: RequestContext): Promise<DashboardDefault | null> {
  if (!ctx.membership) return null

  const rows = await ctx.db((tx) =>
    tx
      .select({
        roleId: roles.id,
        key: roles.key,
        name: roles.name,
        isBuiltIn: roles.isBuiltIn,
        permissions: roles.permissions,
        layout: roleDashboardLayouts.layout,
      })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .leftJoin(
        roleDashboardLayouts,
        and(
          eq(roleDashboardLayouts.roleId, roles.id),
          eq(roleDashboardLayouts.tenantId, ctx.tenantId),
        ),
      )
      .where(eq(roleAssignments.tenantUserId, ctx.membership!.id)),
  )

  const candidates = rows.filter((r) => r.layout != null)
  candidates.sort((a, b) => {
    const aTier = inferRoleTier(a)
    const bTier = inferRoleTier(b)
    const tier = TIER_RANK[aTier] - TIER_RANK[bTier]
    if (tier !== 0) return tier
    if (a.isBuiltIn !== b.isBuiltIn) return a.isBuiltIn ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const selected = candidates[0]
  if (!selected?.layout) return null
  return {
    layout: selected.layout,
    sourceKey: dashboardSourceKeyForRole(selected.roleId),
  }
}

export async function resolveDashboardDefault(
  ctx: RequestContext,
  role: RoleTier,
): Promise<DashboardDefault> {
  const roleDefault = await loadAssignedRoleDefault(ctx)
  if (roleDefault) return roleDefault
  return {
    layout: DEFAULT_LAYOUTS[role] ?? DEFAULT_LAYOUTS.worker,
    sourceKey: dashboardSourceKeyForTier(role),
  }
}

export async function loadDashboardLayout(
  ctx: RequestContext,
): Promise<{ layout: DashboardLayoutData; role: RoleTier; isCustomised: boolean }> {
  const role = await getUserRoleTier(ctx)
  const fallback = await resolveDashboardDefault(ctx, role)

  // Super-admin doesn't have a tenant_users row, so no per-user record exists.
  if (!ctx.membership) {
    return { layout: fallback.layout, role, isCustomised: false }
  }

  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .select()
      .from(userDashboardLayouts)
      .where(
        and(
          eq(userDashboardLayouts.tenantId, ctx.tenantId),
          eq(userDashboardLayouts.userId, ctx.userId),
        ),
      )
      .limit(1)
    return r ?? null
  })

  if (!row || row.sourceRole !== fallback.sourceKey) {
    return { layout: fallback.layout, role, isCustomised: false }
  }
  return { layout: row.layout, role, isCustomised: row.isCustomised }
}
