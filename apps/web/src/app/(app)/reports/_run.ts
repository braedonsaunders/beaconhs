import { eq } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { tenants } from '@beaconhs/db/schema'
import { resolveTenantLogoUrl } from '@beaconhs/storage'
import { type ReportRuleGroup, type ReportRunResult } from '@beaconhs/reports'
import { loadBeaconReportCatalog, runBeaconReport } from '@beaconhs/reports/server'
import type { RequestContext } from '@beaconhs/tenant'
import type { ReportDefinitionRow } from './_definitions'

export const DOCUMENT_PREVIEW_MAX_ROWS = 500

export async function runReportForViewer(
  ctx: RequestContext,
  definition: ReportDefinitionRow,
  options: {
    maxRows?: number
    filters?: ReportRuleGroup | null
    groupBy?: string | null
  } = {},
): Promise<{ result: ReportRunResult; error: string | null }> {
  try {
    const result = await ctx.db(async (tx) => {
      const catalog = await loadBeaconReportCatalog(tx)
      return runBeaconReport(
        tx,
        ctx.tenantId!,
        {
          ...definition.query,
          ...(options.filters === undefined ? {} : { filters: options.filters }),
          ...(options.groupBy === undefined ? {} : { groupBy: options.groupBy }),
        },
        catalog,
        { maxRows: options.maxRows ?? DOCUMENT_PREVIEW_MAX_ROWS },
      )
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
