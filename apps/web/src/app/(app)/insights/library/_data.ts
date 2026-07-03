import 'server-only'

// The Insights library's dashboards list: published dashboards, filtered at
// READ TIME by role visibility (mirrors the Forms gallery). Never trust the
// client — the filter happens here, on the server, under RLS. Cards come from
// loadCardsForPalette (the single cards source).

import { and, desc, eq, isNull } from 'drizzle-orm'
import type { RequestContext } from '@beaconhs/tenant'
import { insightDashboardPins, insightDashboards } from '@beaconhs/db/schema'
import { canSeePublishedInsight, getInsightRoleKeys } from '../_visibility'

export type LibraryDashboard = { id: string; name: string; pinned: boolean }

export async function loadLibraryDashboards(ctx: RequestContext): Promise<LibraryDashboard[]> {
  const roleKeys = await getInsightRoleKeys(ctx)

  const dashRows = await ctx.db((tx) =>
    tx
      .select({
        id: insightDashboards.id,
        name: insightDashboards.name,
        allowedRoles: insightDashboards.allowedRoles,
      })
      .from(insightDashboards)
      .where(and(eq(insightDashboards.status, 'published'), isNull(insightDashboards.deletedAt)))
      .orderBy(desc(insightDashboards.publishedAt)),
  )

  const pins = await ctx.db((tx) =>
    tx
      .select({ dashboardId: insightDashboardPins.dashboardId })
      .from(insightDashboardPins)
      .where(eq(insightDashboardPins.userId, ctx.userId)),
  )
  const pinnedSet = new Set(pins.map((p) => p.dashboardId))

  return dashRows
    .filter((d) => canSeePublishedInsight(ctx, d.allowedRoles, roleKeys))
    .map((d) => ({ id: d.id, name: d.name, pinned: pinnedSet.has(d.id) }))
}
