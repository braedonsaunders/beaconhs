import 'server-only'

// App-level role gating (form_templates.allowedRoles). Empty/null ⇒ everyone.
// Non-empty ⇒ only those role keys, plus admins (forms.template.create) and
// super-admins. Used by the gallery (/forms) + the fill page.

import { eq } from 'drizzle-orm'
import { can, type RequestContext } from '@beaconhs/tenant'
import { roleAssignments, roles } from '@beaconhs/db/schema'

export async function getUserRoleKeys(ctx: RequestContext): Promise<Set<string>> {
  if (!ctx.membership) return new Set()
  const membershipId = ctx.membership.id
  const rows = await ctx.db((tx) =>
    tx
      .select({ key: roles.key })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(eq(roleAssignments.tenantUserId, membershipId)),
  )
  return new Set(rows.map((r) => r.key))
}

export function appVisibleTo(
  ctx: RequestContext,
  allowedRoles: string[] | null | undefined,
  userRoleKeys: Set<string>,
): boolean {
  if (!allowedRoles || allowedRoles.length === 0) return true
  if (ctx.isSuperAdmin || can(ctx, 'forms.template.create')) return true
  return allowedRoles.some((r) => userRoleKeys.has(r))
}
