// Data for the Insights dashboards: the user's dashboard tabs and the
// server-compiled Card renders (each under RLS). Every metric widget is a
// BHQL-backed system card; the only bespoke payload left is the AI flag.

import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import {
  insightDashboardPins,
  insightDashboards,
  type BhqlQuery,
  type DashboardParam,
  type DashboardParamMap,
  type InsightDashboardLayout,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import type { BhqlResult } from '@beaconhs/analytics'
import { addTrustedSystemFormEntity, runBhql } from '@beaconhs/analytics/server'
import { resolveAnalyticsAccess } from '@/lib/analytics-access'
import { applyParams } from './_params'
import { canSeePublishedInsight, getInsightRoleKeys } from './_visibility'
import { DEFAULT_INSIGHT_LAYOUT } from './_widgets'
import type { CardRow } from './cards/_data'

// Short-TTL in-memory cache for compiled card results. Keyed by tenant + the
// FINAL (param-injected) query, so it's RLS-correct (a key is one tenant's view)
// and parameter-aware. Dashboards re-render often (param tweaks, tab switches,
// the homepage on every nav) and the same card recurs across boards — this keeps
// a busy dashboard from recompiling identical queries. Per-process (fine for a
// 60s window); the value is already the tenant-scoped result.
const CARD_RESULT_CACHE = new Map<string, { at: number; result: BhqlResult }>()
const CARD_RESULT_TTL_MS = 60_000

async function runCardCached(
  ctx: RequestContext,
  query: BhqlQuery,
  key: string,
  trustedSystemCard: boolean,
): Promise<BhqlResult> {
  return ctx.db(async (tx) => {
    const access = await resolveAnalyticsAccess(ctx, tx)
    const trustScope = trustedSystemCard ? 'system' : 'user'
    const cacheKey = `${ctx.tenantId}:${access.scopeKey}:${trustScope}:${key}`
    const now = Date.now()
    const hit = CARD_RESULT_CACHE.get(cacheKey)
    if (hit && now - hit.at < CARD_RESULT_TTL_MS) return hit.result
    const result = await runBhql(tx, query, {
      maxRows: 20_000,
      entityMap: trustedSystemCard
        ? addTrustedSystemFormEntity(access.entityMap)
        : access.entityMap,
    })
    CARD_RESULT_CACHE.set(cacheKey, { at: now, result })
    if (CARD_RESULT_CACHE.size > 2_000) {
      for (const [k, v] of CARD_RESULT_CACHE)
        if (now - v.at > CARD_RESULT_TTL_MS) CARD_RESULT_CACHE.delete(k)
    }
    return result
  })
}

/** A Card compiled for a dashboard cell (server-side, under RLS). */
export type CardRender = {
  id: string
  name: string
  kind: string
  vizType: string
  vizSettings: Record<string, unknown>
  result: BhqlResult | null
  error: string | null
  /** For an `ai` card: the stored instruction, rendered with an on-demand button. */
  aiPrompt?: string | null
}

/** Compile each referenced Card's query in parallel (each under its own RLS tx).
 *  When the dashboard defines parameters, `applyParams` folds the current values
 *  into each card's filter before it is compiled, so one control fans out across
 *  every mapped card. AI cards are NOT run here — they execute their model on
 *  demand from the cell, so a dashboard load never pays LLM cost. */
export async function loadDashboardCardRenders(
  ctx: RequestContext,
  cards: Array<
    Pick<
      CardRow,
      'id' | 'name' | 'kind' | 'query' | 'vizType' | 'vizSettings' | 'config' | 'trustedSystemCard'
    >
  >,
  opts: {
    paramValues?: Record<string, unknown>
    paramMap?: DashboardParamMap
    params?: DashboardParam[]
  } = {},
): Promise<CardRender[]> {
  const { paramValues = {}, paramMap = {}, params = [] } = opts
  return Promise.all(
    cards.map(async (c) => {
      const base = {
        id: c.id,
        name: c.name,
        kind: c.kind,
        vizType: c.vizType,
        vizSettings: c.vizSettings,
      }
      if (c.kind === 'ai') {
        return {
          ...base,
          result: null,
          error: null,
          aiPrompt: c.config?.kind === 'ai' ? c.config.prompt : null,
        }
      }
      try {
        const query = applyParams(c.query, paramValues, paramMap, c.id, params)
        const result = await runCardCached(
          ctx,
          query,
          JSON.stringify(query),
          c.trustedSystemCard === true,
        )
        return { ...base, result, error: null }
      } catch (e) {
        return {
          ...base,
          result: null,
          error: e instanceof Error ? e.message : 'Could not run this card.',
        }
      }
    }),
  )
}

export type InsightDashboardRow = {
  id: string
  name: string
  layout: InsightDashboardLayout
  params: DashboardParam[]
  paramMap: DashboardParamMap
  /** True for the user's own dashboards; false for pinned (others') ones. */
  owned: boolean
  status: 'draft' | 'published'
  /** Publish restriction (role keys); null/empty = everyone. */
  allowedRoles: string[] | null
}

/** The user's /insights tabs = their OWN dashboards + the published dashboards
 *  they've pinned from the library. A default is created on first visit. */
export async function loadDashboards(
  ctx: RequestContext,
  systemCards: Map<string, { id: string }>,
): Promise<InsightDashboardRow[]> {
  // Remap built-in widget keys onto their real system-card ids so the Overview
  // renders (and persists on save) as actual Cards, not hard-coded widgets.
  const remap = (layout: InsightDashboardLayout): InsightDashboardLayout => ({
    widgets: layout.widgets.map((w) =>
      systemCards.has(w.id) ? { ...w, id: systemCards.get(w.id)!.id } : w,
    ),
  })
  const owned = await ctx.db((tx) =>
    tx
      .select({
        id: insightDashboards.id,
        name: insightDashboards.name,
        sortOrder: insightDashboards.sortOrder,
        layout: insightDashboards.layout,
        params: insightDashboards.params,
        paramMap: insightDashboards.paramMap,
        status: insightDashboards.status,
        allowedRoles: insightDashboards.allowedRoles,
        createdAt: insightDashboards.createdAt,
      })
      .from(insightDashboards)
      .where(and(eq(insightDashboards.userId, ctx.userId), isNull(insightDashboards.deletedAt)))
      .orderBy(asc(insightDashboards.sortOrder), asc(insightDashboards.createdAt)),
  )

  const pinned = await ctx.db((tx) =>
    tx
      .select({
        id: insightDashboards.id,
        name: insightDashboards.name,
        sortOrder: insightDashboardPins.sortOrder,
        layout: insightDashboards.layout,
        params: insightDashboards.params,
        paramMap: insightDashboards.paramMap,
        status: insightDashboards.status,
        allowedRoles: insightDashboards.allowedRoles,
      })
      .from(insightDashboardPins)
      .innerJoin(insightDashboards, eq(insightDashboards.id, insightDashboardPins.dashboardId))
      .where(
        and(
          eq(insightDashboardPins.userId, ctx.userId),
          eq(insightDashboards.status, 'published'),
          isNull(insightDashboards.deletedAt),
        ),
      )
      .orderBy(asc(insightDashboardPins.sortOrder)),
  )
  const roleKeys = await getInsightRoleKeys(ctx)

  if (owned.length === 0 && pinned.length === 0) {
    // Check + insert in ONE transaction guarded by a per-(tenant, user) advisory
    // lock — several first-loads can race (two tabs, prefetch + click) and a bare
    // select-then-insert would double-seed the default (mirrors ensureSystemCards).
    const created = await ctx.db(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.tenantId}:${ctx.userId}:insight-default`}))`,
      )
      const [existing] = await tx
        .select({
          id: insightDashboards.id,
          name: insightDashboards.name,
          layout: insightDashboards.layout,
        })
        .from(insightDashboards)
        .where(and(eq(insightDashboards.userId, ctx.userId), isNull(insightDashboards.deletedAt)))
        .orderBy(asc(insightDashboards.createdAt))
        .limit(1)
      if (existing) return existing
      const [row] = await tx
        .insert(insightDashboards)
        .values({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          name: 'Overview',
          sortOrder: 0,
          layout: DEFAULT_INSIGHT_LAYOUT,
        })
        .returning({
          id: insightDashboards.id,
          name: insightDashboards.name,
          layout: insightDashboards.layout,
        })
      return row
    })
    return created
      ? [
          {
            id: created.id,
            name: created.name,
            layout: remap(created.layout),
            params: [],
            paramMap: {},
            owned: true,
            status: 'draft' as const,
            allowedRoles: null,
          },
        ]
      : []
  }

  return [
    ...owned.map((r) => ({
      id: r.id,
      name: r.name,
      layout: remap(r.layout),
      params: r.params,
      paramMap: r.paramMap,
      owned: true,
      status: r.status,
      allowedRoles: r.allowedRoles,
    })),
    ...pinned
      .filter((r) => canSeePublishedInsight(ctx, r.allowedRoles, roleKeys))
      .map((r) => ({
        id: r.id,
        name: r.name,
        layout: remap(r.layout),
        params: r.params,
        paramMap: r.paramMap,
        owned: false,
        status: r.status,
        allowedRoles: r.allowedRoles,
      })),
  ]
}
