import { redirect } from 'next/navigation'
import { requireRequestContext } from '@/lib/auth'
import { canCreateInsights, canViewInsights } from './_access'
import {
  loadDashboardCardRenders,
  loadDashboards,
  loadInsightsData,
  type CardRender,
} from './_data'
import { discoverEntitiesWithCustomFields } from '@beaconhs/analytics/server'
import { loadCardsForPalette, type CardRow } from './cards/_data'
import { resolveParamValues } from './_params'
import { ensureSystemCards } from './_system-cards'
import { BUILTIN_QUERIES, INSIGHT_WIDGET_MAP } from './_widgets'
import { InsightsWorkspace } from './_workspace'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Insights' }

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  if (!canViewInsights(ctx)) redirect('/dashboard')

  const sp = await searchParams
  // Materialize the BHQL built-ins as real published Cards (idempotent), then
  // load everything: dashboards remap their built-in widget keys onto these card
  // ids, and the palette/library pick them up as published cards.
  const systemCards = await ensureSystemCards(ctx)
  const [dashboards, data, paletteCards] = await Promise.all([
    loadDashboards(ctx, systemCards),
    loadInsightsData(ctx),
    loadCardsForPalette(ctx),
  ])

  // Compile the Cards placed on each dashboard, per dashboard, so a board's own
  // parameter values fan out into its cards (the same card on two boards can be
  // scoped differently). Renders are keyed by `${dashboardId}:${cardId}`.
  const cardsById = new Map(paletteCards.map((c) => [c.id, c]))
  const renderEntries = await Promise.all(
    dashboards.map(async (d) => {
      // Each placed widget that's a saved Card OR a BHQL-backed built-in runs
      // through the engine; legacy built-ins (AI, computed rollups) fall through.
      const items: Array<
        Pick<CardRow, 'id' | 'name' | 'kind' | 'query' | 'vizType' | 'vizSettings' | 'config'>
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
          })
        }
      }
      if (items.length === 0) return [] as [string, CardRender][]
      const paramValues = resolveParamValues(d.params, sp)
      const renders = await loadDashboardCardRenders(ctx, items, {
        paramValues,
        paramMap: d.paramMap,
      })
      return renders.map((r) => [`${d.id}:${r.id}`, r] as [string, CardRender])
    }),
  )
  const cardRenders = Object.fromEntries(renderEntries.flat())

  return (
    <InsightsWorkspace
      initialDashboards={dashboards}
      data={data}
      paletteCards={paletteCards}
      cardRenders={cardRenders}
      canCreate={canCreateInsights(ctx)}
      entities={await ctx.db((tx) => discoverEntitiesWithCustomFields(tx))}
    />
  )
}
