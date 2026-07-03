import { asc, eq } from 'drizzle-orm'
import { roles } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { getUserRoleKeys } from '@/app/(app)/apps/_lib/access'
import { canPublishInsights } from './_access'

export function canSeePublishedInsight(
  ctx: RequestContext,
  allowedRoles: string[] | null,
  roleKeys: Set<string>,
) {
  if (!allowedRoles || allowedRoles.length === 0) return true
  if (ctx.isSuperAdmin || canPublishInsights(ctx)) return true
  return allowedRoles.some((role) => roleKeys.has(role))
}

export async function getInsightRoleKeys(ctx: RequestContext) {
  return getUserRoleKeys(ctx)
}

export type InsightRoleOption = { key: string; name: string }

/** Tenant roles offered as publish-restriction targets (allowedRoles). */
export async function loadInsightRoleOptions(ctx: RequestContext): Promise<InsightRoleOption[]> {
  return ctx.db((tx) =>
    tx
      .select({ key: roles.key, name: roles.name })
      .from(roles)
      .where(eq(roles.tenantId, ctx.tenantId))
      .orderBy(asc(roles.name)),
  )
}
