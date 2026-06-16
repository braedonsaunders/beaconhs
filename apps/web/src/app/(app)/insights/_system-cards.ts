import 'server-only'

// The built-in BHQL widgets, materialized as REAL published insight_cards (one
// per tenant, idempotent upsert by name). This makes them first-class cards —
// visible in the Library, editable, publishable, pinnable — and a single source
// of truth: the Overview references the same card rows (via the systemKey→id map)
// rather than a separate hard-coded query.

import { and, eq, inArray, isNull } from 'drizzle-orm'
import { insightCards, type BhqlQuery } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { BUILTIN_QUERIES, INSIGHT_WIDGET_MAP } from './_widgets'

export type SystemCard = {
  id: string
  name: string
  query: BhqlQuery
  vizType: string
  vizSettings: Record<string, unknown>
}

/** Ensure the BHQL built-ins exist as published Cards for this tenant. Returns
 *  systemKey → Card so the Overview layout can be remapped onto the real ids. */
export async function ensureSystemCards(ctx: RequestContext): Promise<Map<string, SystemCard>> {
  const defs = Object.entries(BUILTIN_QUERIES).map(([key, b]) => ({
    key,
    name: INSIGHT_WIDGET_MAP.get(key)?.label ?? key,
    description: INSIGHT_WIDGET_MAP.get(key)?.description ?? null,
    query: b.query,
    vizType: b.vizType,
    vizSettings: b.vizSettings ?? {},
  }))
  const names = defs.map((d) => d.name)

  const select = {
    id: insightCards.id,
    name: insightCards.name,
    query: insightCards.query,
    vizType: insightCards.vizType,
    vizSettings: insightCards.vizSettings,
  }

  const existing = await ctx.db((tx) =>
    tx
      .select(select)
      .from(insightCards)
      .where(
        and(
          eq(insightCards.tenantId, ctx.tenantId),
          isNull(insightCards.deletedAt),
          inArray(insightCards.name, names),
        ),
      ),
  )
  const byName = new Map(existing.map((c) => [c.name, c]))

  const missing = defs.filter((d) => !byName.has(d.name))
  if (missing.length > 0) {
    const inserted = await ctx.db((tx) =>
      tx
        .insert(insightCards)
        .values(
          missing.map((d) => ({
            tenantId: ctx.tenantId,
            createdBy: null,
            name: d.name,
            description: d.description,
            query: d.query,
            vizType: d.vizType,
            vizSettings: d.vizSettings,
            status: 'published' as const,
            publishedAt: new Date(),
          })),
        )
        .returning(select),
    )
    for (const c of inserted) byName.set(c.name, c)
  }

  const map = new Map<string, SystemCard>()
  for (const d of defs) {
    const c = byName.get(d.name)
    if (c) {
      map.set(d.key, {
        id: c.id,
        name: c.name,
        query: c.query,
        vizType: c.vizType,
        vizSettings: (c.vizSettings ?? {}) as Record<string, unknown>,
      })
    }
  }
  return map
}
