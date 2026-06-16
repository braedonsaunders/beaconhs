import 'server-only'

// The Insights library: published Cards + dashboards, filtered at READ TIME by
// role visibility (mirrors the Forms gallery). Never trust the client — the
// filter happens here, on the server, under RLS.

import { and, desc, eq, isNull } from 'drizzle-orm'
import type { RequestContext } from '@beaconhs/tenant'
import { insightCards, insightDashboardPins, insightDashboards } from '@beaconhs/db/schema'
import { getUserRoleKeys } from '@/app/(app)/forms/_lib/access'
import { canPublishInsights } from '../_access'

function visible(
  ctx: RequestContext,
  allowedRoles: string[] | null,
  roleKeys: Set<string>,
): boolean {
  if (!allowedRoles || allowedRoles.length === 0) return true
  if (ctx.isSuperAdmin || canPublishInsights(ctx)) return true
  return allowedRoles.some((r) => roleKeys.has(r))
}

export type LibraryCard = { id: string; name: string; description: string | null; vizType: string }
export type LibraryDashboard = { id: string; name: string; pinned: boolean }

export async function loadLibrary(
  ctx: RequestContext,
): Promise<{ cards: LibraryCard[]; dashboards: LibraryDashboard[] }> {
  const roleKeys = await getUserRoleKeys(ctx)

  const cardRows = await ctx.db((tx) =>
    tx
      .select({
        id: insightCards.id,
        name: insightCards.name,
        description: insightCards.description,
        vizType: insightCards.vizType,
        allowedRoles: insightCards.allowedRoles,
      })
      .from(insightCards)
      .where(and(eq(insightCards.status, 'published'), isNull(insightCards.deletedAt)))
      .orderBy(desc(insightCards.publishedAt)),
  )

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

  return {
    cards: cardRows
      .filter((c) => visible(ctx, c.allowedRoles, roleKeys))
      .map((c) => ({ id: c.id, name: c.name, description: c.description, vizType: c.vizType })),
    dashboards: dashRows
      .filter((d) => visible(ctx, d.allowedRoles, roleKeys))
      .map((d) => ({ id: d.id, name: d.name, pinned: pinnedSet.has(d.id) })),
  }
}
