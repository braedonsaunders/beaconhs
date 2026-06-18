// Card loaders (plain server functions — not actions).

import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { insightCards, type BhqlQuery, type InsightCardConfig } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'

export type CardKind = 'question' | 'model' | 'metric' | 'ai'

export type CardRow = {
  id: string
  name: string
  description: string | null
  kind: CardKind
  query: BhqlQuery
  vizType: string
  vizSettings: Record<string, unknown>
  config: InsightCardConfig | null
  status: 'draft' | 'published'
  createdBy: string | null
  allowedRoles: string[] | null
}

const SELECT = {
  id: insightCards.id,
  name: insightCards.name,
  description: insightCards.description,
  kind: insightCards.kind,
  query: insightCards.query,
  vizType: insightCards.vizType,
  vizSettings: insightCards.vizSettings,
  config: insightCards.config,
  status: insightCards.status,
  createdBy: insightCards.createdBy,
  allowedRoles: insightCards.allowedRoles,
}

function map(row: CardRow): CardRow {
  return { ...row }
}

export async function loadCard(ctx: RequestContext, id: string): Promise<CardRow | null> {
  const [row] = await ctx.db((tx) =>
    tx
      .select(SELECT)
      .from(insightCards)
      .where(and(eq(insightCards.id, id), isNull(insightCards.deletedAt)))
      .limit(1),
  )
  return row ? map(row) : null
}

/** Cards available to drop on a dashboard: the user's own + any published. */
export async function loadCardsForPalette(ctx: RequestContext): Promise<CardRow[]> {
  const rows = await ctx.db((tx) =>
    tx
      .select(SELECT)
      .from(insightCards)
      .where(
        and(
          isNull(insightCards.deletedAt),
          or(eq(insightCards.createdBy, ctx.userId), eq(insightCards.status, 'published')),
        ),
      )
      .orderBy(desc(insightCards.updatedAt)),
  )
  return rows.map(map)
}
