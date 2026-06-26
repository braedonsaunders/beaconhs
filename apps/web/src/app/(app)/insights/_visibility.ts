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
