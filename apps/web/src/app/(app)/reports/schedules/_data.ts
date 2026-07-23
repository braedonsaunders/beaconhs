import { asc, eq } from 'drizzle-orm'
import { tenantUsers, users } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import type {
  ReportScheduleDefinitionOption,
  ReportScheduleMemberOption,
} from '@beaconhs/reports/react'
import { reportEntity } from '@beaconhs/reports'
import { loadBeaconReportCatalog } from '@beaconhs/reports/server'
import { loadVisibleDefinitions } from '../_definitions'

export async function loadScheduleFormData(ctx: RequestContext): Promise<{
  definitions: ReportScheduleDefinitionOption[]
  members: ReportScheduleMemberOption[]
}> {
  const definitionRows = await loadVisibleDefinitions(ctx.tenantId!)
  const { catalog, members } = await ctx.db(async (tx) => ({
    catalog: await loadBeaconReportCatalog(tx),
    members: await tx
      .select({
        userId: tenantUsers.userId,
        name: tenantUsers.displayName,
        email: users.email,
      })
      .from(tenantUsers)
      .innerJoin(users, eq(users.id, tenantUsers.userId))
      .where(eq(tenantUsers.status, 'active'))
      .orderBy(asc(tenantUsers.displayName)),
  }))
  return {
    definitions: definitionRows.map((definition) => ({
      id: definition.id,
      name: definition.name,
      category: definition.category,
      description: definition.description,
      entity: reportEntity(catalog, definition.query.entity) ?? undefined,
    })),
    members: members.map((member) => ({
      userId: member.userId,
      name: member.name ?? member.email,
      email: member.email,
    })),
  }
}
