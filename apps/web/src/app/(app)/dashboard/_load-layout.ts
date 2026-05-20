// Load the active dashboard layout for the current user.
// Falls back to the role default if the user hasn't customised.

import { and, eq } from 'drizzle-orm'
import { userDashboardLayouts, type DashboardLayoutData } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { DEFAULT_LAYOUTS } from './_role-defaults'
import { getUserRoleTier, type RoleTier } from './_role-tier'

export async function loadDashboardLayout(
  ctx: RequestContext,
): Promise<{ layout: DashboardLayoutData; role: RoleTier; isCustomised: boolean }> {
  const role = await getUserRoleTier(ctx)
  const fallback = DEFAULT_LAYOUTS[role] ?? DEFAULT_LAYOUTS.worker

  // Super-admin doesn't have a tenant_users row, so no per-user record exists.
  if (!ctx.membership) {
    return { layout: fallback, role, isCustomised: false }
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

  if (!row) return { layout: fallback, role, isCustomised: false }
  return { layout: row.layout, role, isCustomised: row.isCustomised }
}
