// Shared loader for report definitions visible to a tenant. Returns the union
// of every built-in definition (tenant_id IS NULL) and any custom definition
// owned by the active tenant. Read with super-admin bypass since built-ins
// have no tenant and tenant-scoped RLS would filter them out.

import { and, asc, eq, isNull, or } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import {
  reportDefinitions,
  type ReportCustomQuery,
  type ReportLayoutConfig,
} from '@beaconhs/db/schema'

export type ReportDefinitionRow = {
  id: string
  tenantId: string | null
  kind: 'built_in' | 'custom'
  slug: string
  name: string
  description: string | null
  category: string | null
  queryKind: string
  customQuery: ReportCustomQuery | null
  layout: ReportLayoutConfig | null
  createdAt: Date
  updatedAt: Date
}

export async function loadVisibleDefinitions(tenantId: string): Promise<ReportDefinitionRow[]> {
  return await withSuperAdmin(db, async (tx) => {
    const rows = await tx
      .select()
      .from(reportDefinitions)
      .where(or(isNull(reportDefinitions.tenantId), eq(reportDefinitions.tenantId, tenantId)))
      .orderBy(asc(reportDefinitions.category), asc(reportDefinitions.name))
    return rows.map((r) => ({
      ...r,
      tenantId: r.tenantId ?? null,
      customQuery: (r.customQuery as ReportCustomQuery | null) ?? null,
      layout: (r.layout as ReportLayoutConfig | null) ?? null,
    }))
  })
}

export async function loadDefinitionById(
  tenantId: string,
  id: string,
): Promise<ReportDefinitionRow | null> {
  return await withSuperAdmin(db, async (tx) => {
    const [r] = await tx
      .select()
      .from(reportDefinitions)
      .where(
        and(
          eq(reportDefinitions.id, id),
          or(isNull(reportDefinitions.tenantId), eq(reportDefinitions.tenantId, tenantId)),
        ),
      )
      .limit(1)
    if (!r) return null
    return {
      ...r,
      tenantId: r.tenantId ?? null,
      customQuery: (r.customQuery as ReportCustomQuery | null) ?? null,
      layout: (r.layout as ReportLayoutConfig | null) ?? null,
    }
  })
}
