// Shared loader for the schedule form: visible definitions (built-in +
// own-tenant custom) and the tenant's ACTIVE members for the recipient
// picker (invited/suspended memberships are excluded; emails included to
// disambiguate duplicate display names).

import { asc, eq } from 'drizzle-orm'
import { tenantUsers, users } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { loadVisibleDefinitions } from '../_definitions'
import type { ScheduleFormDefinition, ScheduleFormMember } from './_schedule-form'

export async function loadScheduleFormData(ctx: RequestContext): Promise<{
  definitions: ScheduleFormDefinition[]
  members: ScheduleFormMember[]
}> {
  const definitions = (await loadVisibleDefinitions(ctx.tenantId!)).map((d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    kind: d.kind,
    description: d.description,
    queryKind: d.queryKind,
  }))

  const members = await ctx.db(async (tx) => {
    const rows = await tx
      .select({ userId: tenantUsers.userId, name: tenantUsers.displayName, email: users.email })
      .from(tenantUsers)
      .innerJoin(users, eq(users.id, tenantUsers.userId))
      .where(eq(tenantUsers.status, 'active'))
      .orderBy(asc(tenantUsers.displayName))
    return rows.map((m) => ({ userId: m.userId, name: m.name ?? m.email, email: m.email }))
  })

  return { definitions, members }
}
