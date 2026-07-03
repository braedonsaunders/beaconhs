import { redirect } from 'next/navigation'
import { requireRequestContext } from '@/lib/auth'
import { getTenantAiConfig } from '@/lib/ai-config'
import { canCreateInsights, canPublishInsights, canViewInsights } from './_access'
import { loadDashboardCardRenders, loadDashboards, type CardRender } from './_data'
import { loadCardsForPalette, loadStudioEntities, type CardRow } from './cards/_data'
import { resolveParamValues } from './_params'
import { ensureSystemCards } from './_system-cards'
import { loadInsightRoleOptions } from './_visibility'
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
  const canPublish = canPublishInsights(ctx)
  // Materialize the BHQL built-ins as real published Cards (idempotent), then
  // load everything: dashboards remap their built-in widget keys onto these card
  // ids, and the palette/library pick them up as published cards.
  const systemCards = await ensureSystemCards(ctx)
  const [dashboards, paletteCards, aiConfig, entities, roleOptions] = await Promise.all([
    loadDashboards(ctx, systemCards),
    loadCardsForPalette(ctx),
    getTenantAiConfig(ctx),
    // Studio entities (base registry + Builder-app-scoped), so the dashboard
    // filter drawer can map params onto app-backed cards too.
    loadStudioEntities(ctx),
    canPublish ? loadInsightRoleOptions(ctx) : Promise.resolve([]),
  ])

  // Compile the Cards placed on each dashboard, per dashboard, so a board's own
  // parameter values fan out into its cards (the same card on two boards can be
  // scoped differently). Renders are keyed by `${dashboardId}:${cardId}`.
  const cardsById = new Map(paletteCards.map((c) => [c.id, c]))
  const renderEntries = await Promise.all(
    dashboards.map(async (d) => {
      // Each placed widget that's a saved Card OR a BHQL-backed built-in runs
      // through the engine; the AI journal widget falls through (bespoke render).
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
        params: d.params,
      })
      return renders.map((r) => [`${d.id}:${r.id}`, r] as [string, CardRender])
    }),
  )
  const cardRenders = Object.fromEntries(renderEntries.flat())

  return (
    <InsightsWorkspace
      initialDashboards={dashboards}
      aiEnabled={aiConfig !== null}
      paletteCards={paletteCards}
      cardRenders={cardRenders}
      canCreate={canCreateInsights(ctx)}
      canPublish={canPublish}
      roles={roleOptions}
      entities={entities}
    />
  )
}
