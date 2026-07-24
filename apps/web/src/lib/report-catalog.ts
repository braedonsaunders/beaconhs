import 'server-only'

import type { Database } from '@beaconhs/db'
import { loadBeaconReportCatalog } from '@beaconhs/reports/server'
import type { RequestContext } from '@beaconhs/tenant'
import { resolveAnalyticsAccess } from './analytics-access'

/**
 * Reports and Insights share one authorization-aware source inventory.
 * AppKit receives only the already-authorized Beacon catalogue.
 */
export async function loadAuthorizedReportCatalogInTransaction(ctx: RequestContext, tx: Database) {
  const access = await resolveAnalyticsAccess(ctx, tx)
  return loadBeaconReportCatalog(tx, access.entities)
}

export async function loadAuthorizedReportCatalog(ctx: RequestContext) {
  return ctx.db((tx) => loadAuthorizedReportCatalogInTransaction(ctx, tx))
}
