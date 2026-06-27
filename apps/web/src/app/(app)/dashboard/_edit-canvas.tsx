import type React from 'react'
import type { RequestContext } from '@beaconhs/tenant'
import type { DashboardLayoutData } from '@beaconhs/db/schema'
import type { SaveQuickActionsAction } from './_quick-actions-shared'
import { loadCardsForPalette, type CardRow } from '../insights/cards/_data'
import { loadDashboardCardRenders } from '../insights/_data'
import { ensureSystemCards } from '../insights/_system-cards'
import { CardCell } from '../insights/_viz/card-cell.client'
import { loadDashboardMetrics } from './_metrics'
import { WIDGETS, WIDGET_CARD_KEY } from './_widget-registry'
import { WidgetCard } from './_widget-views'
import { UUID_RE } from './_layout-input'

export async function loadDashboardEditCanvas(
  ctx: RequestContext,
  layout: DashboardLayoutData,
  opts: {
    includeLibraryCards: boolean
    filterLibraryCard?: (card: CardRow) => boolean
    quickActionsSaveAction?: SaveQuickActionsAction
    quickActionsSaveSuccessMessage?: string
  },
): Promise<{
  nodes: Record<string, React.ReactNode>
  libraryCards: { id: string; name: string; description: string }[]
}> {
  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)
  const [data, paletteCards, systemCards] = await Promise.all([
    loadDashboardMetrics(ctx, today),
    opts.includeLibraryCards ? loadCardsForPalette(ctx) : Promise.resolve([]),
    ensureSystemCards(ctx),
  ])

  const visiblePaletteCards = opts.filterLibraryCard
    ? paletteCards.filter(opts.filterLibraryCard)
    : paletteCards

  const nodes: Record<string, React.ReactNode> = {}
  for (const id of Object.keys(WIDGETS)) {
    nodes[id] = (
      <WidgetCard
        widgetId={id}
        data={data}
        todayIso={todayIso}
        quickActions={layout.quickActions}
        quickActionsSaveAction={opts.quickActionsSaveAction}
        quickActionsSaveSuccessMessage={opts.quickActionsSaveSuccessMessage}
      />
    )
  }

  type CardItem = Parameters<typeof loadDashboardCardRenders>[1][number]
  const sysItems: CardItem[] = []
  const widgetKeyByCardId = new Map<string, string>()
  for (const [widgetKey, insightKey] of Object.entries(WIDGET_CARD_KEY)) {
    const card = systemCards.get(insightKey)
    if (!card) continue
    sysItems.push({ ...card, kind: 'question', config: null })
    widgetKeyByCardId.set(card.id, widgetKey)
  }
  if (sysItems.length > 0) {
    const renders = await loadDashboardCardRenders(ctx, sysItems)
    for (const r of renders) {
      const widgetKey = widgetKeyByCardId.get(r.id)
      if (widgetKey) nodes[widgetKey] = <CardCell key={widgetKey} render={r} />
    }
  }

  const cardById = new Map(visiblePaletteCards.map((c) => [c.id, c]))
  const placedCards = layout.widgets
    .filter((w) => !(w.id in WIDGETS) && UUID_RE.test(w.id))
    .map((w) => cardById.get(w.id))
    .filter((c) => c != null)

  if (placedCards.length > 0) {
    const renders = await loadDashboardCardRenders(ctx, placedCards)
    for (const r of renders) nodes[r.id] = <CardCell key={r.id} render={r} />
  }

  return {
    nodes,
    libraryCards: visiblePaletteCards.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description ?? '',
    })),
  }
}
