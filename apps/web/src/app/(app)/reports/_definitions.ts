import { and, asc, eq, ne } from 'drizzle-orm'
import { db, withTenant } from '@beaconhs/db'
import { reportDefinitions } from '@beaconhs/db/schema'
import type { CustomReportDefinition } from '@beaconhs/reports'

export type ReportDefinitionRow = typeof reportDefinitions.$inferSelect

export function toAppKitDefinition(row: ReportDefinitionRow): CustomReportDefinition {
  return {
    schemaVersion: 1,
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? undefined,
    query: row.query,
    layout: row.layout,
    state: row.state,
    tags: row.tags,
    builtIn: row.seedKey != null,
  }
}

export async function loadVisibleDefinitions(tenantId: string): Promise<ReportDefinitionRow[]> {
  return withTenant(db, tenantId, (tx) =>
    tx
      .select()
      .from(reportDefinitions)
      .where(and(eq(reportDefinitions.tenantId, tenantId), ne(reportDefinitions.state, 'archived')))
      .orderBy(asc(reportDefinitions.category), asc(reportDefinitions.name)),
  )
}

export async function loadDefinitionById(
  tenantId: string,
  id: string,
): Promise<ReportDefinitionRow | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(reportDefinitions)
      .where(and(eq(reportDefinitions.tenantId, tenantId), eq(reportDefinitions.id, id)))
      .limit(1)
    return row ?? null
  })
}
