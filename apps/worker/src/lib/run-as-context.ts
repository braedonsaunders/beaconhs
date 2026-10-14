// Re-authorizes a scheduled job as the tenant member (and optionally the role)
// it was saved under, at execution time. Scheduled reports and AI briefs both
// run through here, so a suspended member or a revoked role stops every
// scheduled read the same way.

import { and, eq, isNull } from 'drizzle-orm'
import { db, type Database } from '@beaconhs/db'
import { people, tenants, tenantUsers, users } from '@beaconhs/db/schema'
import { resolveLocalePreferences } from '@beaconhs/i18n'
import { makeTenantContext, resolveMembershipAccess, type RequestContext } from '@beaconhs/tenant'

export type RunAsContext = {
  requestCtx: RequestContext
  locale: ReturnType<typeof resolveLocalePreferences>['locale']
  roleKeys: ReadonlySet<string>
}

export async function resolveRunAsContext(
  tx: Database,
  tenantId: string,
  principal: { tenantUserId: string; roleId: string | null },
  label: string,
): Promise<RunAsContext> {
  const [member] = await tx
    .select({
      id: tenantUsers.id,
      userId: tenantUsers.userId,
      displayName: tenantUsers.displayName,
      status: tenantUsers.status,
      localeOverride: tenantUsers.localeOverride,
      timezone: users.timezone,
      isSuperAdmin: users.isSuperAdmin,
      personId: people.id,
    })
    .from(tenantUsers)
    .innerJoin(users, eq(users.id, tenantUsers.userId))
    .leftJoin(
      people,
      and(
        eq(people.userId, tenantUsers.userId),
        eq(people.tenantId, tenantUsers.tenantId),
        isNull(people.deletedAt),
      ),
    )
    .where(
      and(
        eq(tenantUsers.id, principal.tenantUserId),
        eq(tenantUsers.tenantId, tenantId),
        eq(tenantUsers.status, 'active'),
      ),
    )
    .limit(1)
  if (!member || member.status !== 'active') {
    throw new Error(`${label} run-as membership is no longer active`)
  }
  const [tenantLocale] = await tx
    .select({
      defaultLanguage: tenants.defaultLanguage,
      enabledLanguages: tenants.enabledLanguages,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
  if (!tenantLocale) throw new Error(`${label} tenant no longer exists`)
  const localePolicy = resolveLocalePreferences({
    defaultLocale: tenantLocale.defaultLanguage,
    enabledLocales: tenantLocale.enabledLanguages,
    userLocale: member.localeOverride,
  })

  const resolved = await resolveMembershipAccess(tx, member.id, principal.roleId)
  if (principal.roleId && resolved.appliedRoleId !== principal.roleId) {
    throw new Error(`${label} run-as role is no longer assigned to that member`)
  }
  const requestCtx = makeTenantContext(db, {
    userId: member.userId,
    tenantId,
    isSuperAdmin: member.isSuperAdmin,
    timezone: member.timezone,
    ...localePolicy,
    membership: { id: member.id, displayName: member.displayName ?? member.userId },
    personId: member.personId ?? null,
    permissions: resolved.permissions,
    scopes: resolved.scopes,
    activeRoleId: resolved.appliedRoleId,
  })
  return { requestCtx, locale: localePolicy.locale, roleKeys: resolved.roleKeys }
}
