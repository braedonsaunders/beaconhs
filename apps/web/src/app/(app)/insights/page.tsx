import { getGeneratedTranslations } from '@/i18n/generated.server'
import { redirect } from 'next/navigation'
import { requireRequestContext } from '@/lib/auth'
import { canCreateInsights, canPublishInsights, canViewInsights } from './_access'
import { loadDashboardCardRenders, loadDashboards, type CardRender } from './_data'
import { asc, eq } from 'drizzle-orm'
import { briefs } from '@beaconhs/db/schema'
import type { BriefWidgetData } from '@/components/briefs/brief-widget'
import { canReadBriefs } from '@/lib/briefs/access'
import { latestBriefRuns } from '@/lib/briefs/data'
import { loadCardsForPalette, loadStudioEntities, type CardRow } from './cards/_data'
import { resolveParamValues } from './_params'
import { ensureSystemCards } from './_system-cards'
import { loadInsightRoleOptions } from './_visibility'
import { BUILTIN_QUERIES, INSIGHT_WIDGET_MAP } from './_widgets'
import { InsightsWorkspace } from './_workspace'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_06145df9e2eb0d') }
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  if (!canViewInsights(ctx)) redirect('/dashboard')

  const sp = await searchParams
  const canPublish = canPublishInsights(ctx)
  // Materialize the BHQL built-ins as real published Cards (idempotent), then
  // load everything: dashboards remap their built-in widget keys onto these card
  // ids, and the palette/library pick them up as published cards.
  const systemCards = await ensureSystemCards(ctx)
  const [dashboards, paletteCards, entities, roleOptions, briefWidgets] = await Promise.all([
    loadDashboards(ctx, systemCards),
    loadCardsForPalette(ctx),
    // Studio entities (base registry + Builder-app-scoped), so the dashboard
    // filter drawer can map params onto app-backed cards too.
    loadStudioEntities(ctx),
    canPublish ? loadInsightRoleOptions(ctx) : Promise.resolve([]),
    loadBriefWidgets(ctx),
  ])

  // Compile the Cards placed on each dashboard, per dashboard, so a board's own
  // parameter values fan out into its cards (the same card on two boards can be
  // scoped differently). Renders are keyed by `${dashboardId}:${cardId}`.
  const cardsById = new Map(paletteCards.map((c) => [c.id, c]))
  const renderEntries = await Promise.all(
    dashboards.map(async (d) => {
      // Each placed widget that's a saved Card OR a BHQL-backed built-in runs
      // through the engine; AI brief widgets fall through (latest run render).
      const items: Array<
        Pick<CardRow, 'id' | 'name' | 'kind' | 'query' | 'vizType' | 'vizSettings' | 'config'> & {
          trustedSystemCard?: true
        }
      > = []
      for (const w of d.layout.widgets) {
        const card = cardsById.get(w.id)
        if (card) {
          items.push(card)
          continue
        }
        const builtin = BUILTIN_QUERIES[w.id]
        if (builtin) {
          items.push({
            id: w.id,
            name: INSIGHT_WIDGET_MAP.get(w.id)?.label ?? w.id,
            kind: 'question',
            query: builtin.query,
            vizType: builtin.vizType,
            vizSettings: builtin.vizSettings ?? {},
            config: null,
            trustedSystemCard: true,
          })
        }
      }
      if (items.length === 0) return [] as [string, CardRender][]
      const paramValues = resolveParamValues(d.params, sp)
      const renders = await loadDashboardCardRenders(ctx, items, {
        paramValues,
        paramMap: d.paramMap,
        params: d.params,
      })
      return renders.map((r) => [`${d.id}:${r.id}`, r] as [string, CardRender])
    }),
  )
  const cardRenders = Object.fromEntries(renderEntries.flat())

  return (
    <InsightsWorkspace
      initialDashboards={dashboards}
      briefWidgets={briefWidgets}
      paletteCards={paletteCards}
      cardRenders={cardRenders}
      canCreate={canCreateInsights(ctx)}
      canPublish={canPublish}
      roles={roleOptions}
      entities={entities}
    />
  )
}

/** Active AI briefs the viewer may read, with their latest delivered run. */
async function loadBriefWidgets(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
): Promise<BriefWidgetData[]> {
  if (!canReadBriefs(ctx)) return []
  const rows = await ctx.db((tx) =>
    tx
      .select({ id: briefs.id, name: briefs.name })
      .from(briefs)
      .where(eq(briefs.status, 'active'))
      .orderBy(asc(briefs.name))
      .limit(100),
  )
  const latest = await latestBriefRuns(
    ctx,
    rows.map((r) => r.id),
  )
  return rows.map((row) => {
    const run = latest.get(row.id)
    return {
      id: row.id,
      name: row.name,
      run:
        run?.result && run.evidence
          ? {
              id: run.id,
              windowLabel: run.windowLabel,
              departmentName: run.departmentName,
              result: run.result,
              evidence: run.evidence,
            }
          : null,
    }
  })
}
