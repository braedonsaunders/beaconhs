import { eq } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { tenants } from '@beaconhs/db/schema'
import { resolveTenantLogoUrl } from '@beaconhs/storage'
import {
  reportColumn,
  reportEntity,
  type ReportCustomQuery,
  type ReportRuleGroup,
  type ReportRunResult,
} from '@beaconhs/reports'
import { runBeaconReport } from '@beaconhs/reports/server'
import type { RequestContext } from '@beaconhs/tenant'
import { loadAuthorizedReportCatalogInTransaction } from '@/lib/report-catalog'
import type { ReportDefinitionRow } from './_definitions'

export const DOCUMENT_PREVIEW_MAX_ROWS = 5_000

export function applyRuntimeSortOverride(
  query: ReportCustomQuery,
  sort: { column: string; direction: 'asc' | 'desc' } | null | undefined,
): ReportCustomQuery {
  if (!sort || (query.mode ?? 'rows') !== 'rows') return query
  const existing = query.sorts?.length ? query.sorts : query.sort ? [query.sort] : []
  const merged = [sort, ...existing.filter((item) => item.column !== sort.column)].slice(0, 3)
  return {
    ...query,
    sort: null,
    sorts: merged,
  }
}

export async function runReportForViewer(
  ctx: RequestContext,
  definition: ReportDefinitionRow,
  options: {
    maxRows?: number
    filters?: ReportRuleGroup | null
    groupBy?: string | null
    sort?: { column: string; direction: 'asc' | 'desc' } | null
  } = {},
): Promise<{ result: ReportRunResult; error: string | null }> {
  try {
    const result = await ctx.db(async (tx) => {
      const catalog = await loadAuthorizedReportCatalogInTransaction(ctx, tx)
      if (options.sort) {
        const entity = reportEntity(catalog, definition.query.entity)
        if (!entity || !reportColumn(entity, options.sort.column)) {
          throw new Error('Choose an available sort field.')
        }
      }
      const queryWithControls = applyRuntimeSortOverride(
        {
          ...definition.query,
          ...(options.filters === undefined ? {} : { filters: options.filters }),
          ...(options.groupBy === undefined ? {} : { groupBy: options.groupBy }),
        },
        options.sort,
      )
      return runBeaconReport(tx, ctx.tenantId!, queryWithControls, catalog, {
        maxRows: options.maxRows ?? DOCUMENT_PREVIEW_MAX_ROWS,
        layout: definition.layout,
      })
    })
    return { result, error: null }
  } catch (cause) {
    return {
      result: { groups: [], summary: [], rowCount: 0, truncated: false, durationMs: 0 },
      error: cause instanceof Error ? cause.message : String(cause),
    }
  }
}

export async function loadTenantBranding(ctx: RequestContext) {
  const [tenant] = await withSuperAdmin(db, (tx) =>
    tx
      .select({ name: tenants.name, branding: tenants.branding })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId!))
      .limit(1),
  )
  return {
    name: tenant?.name ?? 'BeaconHS',
    logoUrl: await resolveTenantLogoUrl({
      tenantId: ctx.tenantId!,
      logoUrl: tenant?.branding?.logoUrl,
    }),
    primaryColor: tenant?.branding?.primaryColor ?? null,
  }
}
