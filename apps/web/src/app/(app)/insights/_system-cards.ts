import 'server-only'

// The built-in BHQL widgets, materialized as REAL published insight_cards (one
// per tenant, idempotent upsert by name). This makes them first-class cards —
// visible in the Library, editable, publishable, pinnable — and a single source
// of truth: the Overview references the same card rows (via the systemKey→id map)
// rather than a separate hard-coded query.

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { insightCards, type BhqlQuery } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { validateTrustedSystemBhql } from '@beaconhs/analytics/server'
import { BUILTIN_QUERIES, INSIGHT_WIDGET_MAP } from './_widgets'

type SystemCard = {
  id: string
  name: string
  query: BhqlQuery
  vizType: string
  vizSettings: Record<string, unknown>
  trustedSystemCard: true
}

export function isTrustedSystemCard(card: {
  name: string
  query: BhqlQuery
  createdBy?: string | null
}): boolean {
  if (card.createdBy !== null) return false
  return Object.entries(BUILTIN_QUERIES).some(
    ([key, builtin]) =>
      INSIGHT_WIDGET_MAP.get(key)?.label === card.name &&
      JSON.stringify(builtin.query) === JSON.stringify(card.query),
  )
}

/** Ensure the BHQL built-ins exist as published Cards for this tenant. Returns
 *  systemKey → Card so the Overview layout can be remapped onto the real ids. */
export async function ensureSystemCards(ctx: RequestContext): Promise<Map<string, SystemCard>> {
  const defs = Object.entries(BUILTIN_QUERIES).map(([key, b]) => ({
    key,
    name: INSIGHT_WIDGET_MAP.get(key)?.label ?? key,
    description: INSIGHT_WIDGET_MAP.get(key)?.description ?? null,
    query: validateTrustedSystemBhql(b.query),
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

  // Select + de-dupe + insert in ONE transaction, guarded by a per-tenant
  // advisory lock: ensureSystemCards runs on both /insights and /insights/library,
  // and a fresh server can fire several first-loads at once — without the lock the
  // select-then-insert races and double-seeds. The lock releases at commit.
  const byName = await ctx.db(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${ctx.tenantId} || ':insight-system'))`,
    )

    const existing = await tx
      .select(select)
      .from(insightCards)
      .where(
        and(
          eq(insightCards.tenantId, ctx.tenantId),
          isNull(insightCards.createdBy), // system cards only
          isNull(insightCards.deletedAt),
          inArray(insightCards.name, names),
        ),
      )
      .orderBy(asc(insightCards.createdAt))

    // Keep the oldest card per name; soft-delete any duplicates (self-heals rows
    // a previous unlocked seed may have double-inserted).
    const keep = new Map<string, (typeof existing)[number]>()
    const dupeIds: string[] = []
    for (const c of existing) {
      if (keep.has(c.name)) dupeIds.push(c.id)
      else keep.set(c.name, c)
    }
    if (dupeIds.length > 0) {
      await tx
        .update(insightCards)
        .set({ deletedAt: new Date() })
        .where(inArray(insightCards.id, dupeIds))
    }

    const missing = defs.filter((d) => !keep.has(d.name))
    if (missing.length > 0) {
      const inserted = await tx
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
        .returning(select)
      for (const c of inserted) keep.set(c.name, c)
    }

    // Refresh existing system cards whose definition drifted from BUILTIN_QUERIES
    // (e.g. a built-in query was rewritten to drop a view dependency). System
    // cards are the canonical, managed copy, so the stored row is brought back in
    // line with the code definition.
    for (const d of defs) {
      const c = keep.get(d.name)
      if (!c) continue
      const drifted =
        JSON.stringify(c.query) !== JSON.stringify(d.query) ||
        c.vizType !== d.vizType ||
        JSON.stringify(c.vizSettings ?? {}) !== JSON.stringify(d.vizSettings ?? {})
      if (drifted) {
        await tx
          .update(insightCards)
          .set({ query: d.query, vizType: d.vizType, vizSettings: d.vizSettings })
          .where(eq(insightCards.id, c.id))
        keep.set(d.name, { ...c, query: d.query, vizType: d.vizType, vizSettings: d.vizSettings })
      }
    }
    return keep
  })

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
        trustedSystemCard: true,
      })
    }
  }
  return map
}
