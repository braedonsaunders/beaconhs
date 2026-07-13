import 'server-only'

import { eq } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { roleAssignments, roles } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { effectiveRoleAssignments } from './effective-role-policy'

async function loadAssignedRoleKeys(
  ctx: RequestContext,
  tx: Database,
): Promise<Array<{ roleId: string; key: string }>> {
  if (!ctx.membership) return []
  return tx
    .select({ roleId: roles.id, key: roles.key })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(eq(roleAssignments.tenantUserId, ctx.membership.id))
}

/** Role keys that are effective for this request (one switched role or all). */
export async function getEffectiveRoleKeys(
  ctx: RequestContext,
  tx?: Database,
): Promise<Set<string>> {
  const rows = tx
    ? await loadAssignedRoleKeys(ctx, tx)
    : await ctx.db((scopedTx) => loadAssignedRoleKeys(ctx, scopedTx))
  return new Set(effectiveRoleAssignments(ctx.activeRoleId, rows).map((row) => row.key))
}

/** Role ids that are effective for this request (one switched role or all). */
export async function getEffectiveRoleIds(
  ctx: RequestContext,
  tx?: Database,
): Promise<Set<string>> {
  const rows = tx
    ? await loadAssignedRoleKeys(ctx, tx)
    : await ctx.db((scopedTx) => loadAssignedRoleKeys(ctx, scopedTx))
  return new Set(effectiveRoleAssignments(ctx.activeRoleId, rows).map((row) => row.roleId))
}
