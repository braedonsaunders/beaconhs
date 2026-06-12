// Data for the Insights dashboards — reuses the personal-dashboard cross-module
// metrics + the journal aggregates, trimmed to a lean serializable payload that
// the client widgets render (charts, KPIs).

import { asc, eq } from 'drizzle-orm'
import { insightDashboards, type InsightDashboardLayout } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { getTenantAiConfig } from '@/lib/ai-config'
import { loadDashboardMetrics } from '../dashboard/_metrics'
import { getInsights } from '../journals/_insights'
import { DEFAULT_INSIGHT_LAYOUT } from './_widgets'

export type InsightDashboardRow = { id: string; name: string; layout: InsightDashboardLayout }

/** The user's insight dashboards (tabs), creating a default on first visit. */
export async function loadDashboards(ctx: RequestContext): Promise<InsightDashboardRow[]> {
  const rows = await ctx.db((tx) =>
    tx
      .select({
        id: insightDashboards.id,
        name: insightDashboards.name,
        sortOrder: insightDashboards.sortOrder,
        layout: insightDashboards.layout,
        createdAt: insightDashboards.createdAt,
      })
      .from(insightDashboards)
      .where(eq(insightDashboards.userId, ctx.userId))
      .orderBy(asc(insightDashboards.sortOrder), asc(insightDashboards.createdAt)),
  )
  if (rows.length > 0) {
    return rows.map((r) => ({ id: r.id, name: r.name, layout: r.layout }))
  }
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
  return created ? [{ id: created.id, name: created.name, layout: created.layout }] : []
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
