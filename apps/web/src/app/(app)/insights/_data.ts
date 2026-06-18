// Data for the Insights dashboards — reuses the personal-dashboard cross-module
// metrics + the journal aggregates, trimmed to a lean serializable payload that
// the client widgets render (charts, KPIs).

import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  insightDashboardPins,
  insightDashboards,
  type BhqlQuery,
  type DashboardParam,
  type DashboardParamMap,
  type InsightDashboardLayout,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { runBhql } from '@beaconhs/analytics/server'
import type { BhqlResult } from '@beaconhs/analytics'
import { getTenantAiConfig } from '@/lib/ai-config'
import { loadDashboardMetrics } from '../dashboard/_metrics'
import { getInsights } from '../journals/_insights'
import { applyParams } from './_params'
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
): Promise<BhqlResult> {
  const now = Date.now()
  const hit = CARD_RESULT_CACHE.get(key)
  if (hit && now - hit.at < CARD_RESULT_TTL_MS) return hit.result
  const result = await ctx.db((tx) => runBhql(tx, query, { maxRows: 20_000 }))
  CARD_RESULT_CACHE.set(key, { at: now, result })
  if (CARD_RESULT_CACHE.size > 2_000) {
    for (const [k, v] of CARD_RESULT_CACHE) if (now - v.at > CARD_RESULT_TTL_MS) CARD_RESULT_CACHE.delete(k)
  }
  return result
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
  cards: Array<Pick<CardRow, 'id' | 'name' | 'kind' | 'query' | 'vizType' | 'vizSettings' | 'config'>>,
  opts: { paramValues?: Record<string, unknown>; paramMap?: DashboardParamMap } = {},
): Promise<CardRender[]> {
  const { paramValues = {}, paramMap = {} } = opts
  return Promise.all(
    cards.map(async (c) => {
      const base = { id: c.id, name: c.name, kind: c.kind, vizType: c.vizType, vizSettings: c.vizSettings }
      if (c.kind === 'ai') {
        return {
          ...base,
          result: null,
          error: null,
          aiPrompt: c.config?.kind === 'ai' ? c.config.prompt : null,
        }
      }
      try {
        const query = applyParams(c.query, paramValues, paramMap, c.id)
        const result = await runCardCached(ctx, query, `${ctx.tenantId}:${JSON.stringify(query)}`)
        return { ...base, result, error: null }
      } catch (e) {
        return { ...base, result: null, error: e instanceof Error ? e.message : 'Could not run this card.' }
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

  if (owned.length === 0 && pinned.length === 0) {
    const [created] = await ctx.db((tx) =>
      tx
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
        }),
    )
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
    })),
    ...pinned.map((r) => ({
      id: r.id,
      name: r.name,
      layout: remap(r.layout),
      params: r.params,
      paramMap: r.paramMap,
      owned: false,
      status: r.status,
    })),
  ]
}

export type InsightsData = {
  generatedAt: string
  aiEnabled: boolean
  kpi: {
    incidents30: number
    incidentsPrev30: number
    openCAs: number
    overdueCAs: number
    submissionsToday: number
    expiringCerts: number
    lwActive: number
    ppeOpenIssues: number
    ppeOverdue: number
    peopleCount: number
    inspectionsThisMonth: number
    daysSinceRecordable: number | null
  }
  trir: { value: number | null; prev: number | null; trend: (number | null)[] }
  dart: { value: number | null; prev: number | null; trend: (number | null)[] }
  trainingPct: number | null
  trainingTrend: (number | null)[]
  docPct: number | null
  docTrend: (number | null)[]
  caBuckets: { lt7: number; lt30: number; lt60: number; ge60: number }
  severity: { label: string; value: number }[]
  topSites: { name: string; value: number }[]
  journal: {
    total: number
    submitted: number
    drafts: number
    people: number
    last30: number
    byWeek: { week: string; count: number }[]
    bySite: { name: string; count: number }[]
    byDow: number[]
    topTags: { tag: string; count: number }[]
  }
}

export async function loadInsightsData(ctx: RequestContext): Promise<InsightsData> {
  const [m, j, aiConfig] = await Promise.all([
    loadDashboardMetrics(ctx),
    getInsights(ctx),
    getTenantAiConfig(ctx),
  ])

  return {
    generatedAt: new Date().toISOString(),
    aiEnabled: aiConfig !== null,
    kpi: {
      incidents30: m.incidents30,
      incidentsPrev30: m.incidentsPrev30,
      openCAs: m.openCAs,
      overdueCAs: m.overdueCAs,
      submissionsToday: m.submissionsToday,
      expiringCerts: m.expiringCertsCount,
      lwActive: m.lwActive,
      ppeOpenIssues: m.ppeOpenIssues,
      ppeOverdue: m.ppeInspectionsOverdue,
      peopleCount: m.peopleCount,
      inspectionsThisMonth: m.inspectionsThisMonth,
      daysSinceRecordable: m.daysSinceLastRecordable,
    },
    trir: { value: m.trir.value, prev: m.trir.prevValue, trend: [...m.trir.trend] },
    dart: { value: m.dart.value, prev: m.dart.prevValue, trend: [...m.dart.trend] },
    trainingPct: m.trainingCompliancePct,
    trainingTrend: [...m.trainingComplianceTrend],
    docPct: m.documentCompliancePct,
    docTrend: [...m.documentComplianceTrend],
    caBuckets: m.openCABuckets,
    severity: [
      { label: 'Fatality', value: m.severityDistribution.fatality },
      { label: 'Lost time', value: m.severityDistribution.lostTime },
      { label: 'Medical aid', value: m.severityDistribution.medicalAid },
      { label: 'First aid', value: m.severityDistribution.firstAid },
      { label: 'Near miss', value: m.severityDistribution.nearMiss },
      { label: 'No injury', value: m.severityDistribution.noInjury },
      { label: 'Property', value: m.severityDistribution.propertyDamage },
    ],
    topSites: m.topSitesByIncidents.map((s) => ({ name: s.siteName, value: s.incidents })),
    journal: {
      total: j.total,
      submitted: j.submitted,
      drafts: j.drafts,
      people: j.people,
      last30: j.last30,
      byWeek: j.byWeek,
      bySite: j.bySite,
      byDow: j.byDow,
      topTags: j.topTags,
    },
  }
}
