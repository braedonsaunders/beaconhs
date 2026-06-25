import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { loadDashboardMetrics } from '../_metrics'
import { loadDashboardLayout } from '../_load-layout'
import { ROLE_TIER_LABELS } from '../_role-tier'
import { DashboardGrid } from '../_dashboard-grid'
import { WidgetCard } from '../_widget-views'
import { WIDGETS, WIDGET_CARD_KEY } from '../_widget-registry'
import { canSeeWidget } from '../_widget-access'
import { canViewInsights } from '../../insights/_access'
import { loadCardsForPalette } from '../../insights/cards/_data'
import { loadDashboardCardRenders } from '../../insights/_data'
import { ensureSystemCards } from '../../insights/_system-cards'
import { CardCell } from '../../insights/_viz/card-cell.client'

const UUID_RE = /^[0-9a-f-]{36}$/i

export const metadata = { title: 'Customise Dashboard' }
export const dynamic = 'force-dynamic'

export default async function CustomiseDashboardPage() {
  const ctx = await requireRequestContext()
  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)

  const [{ layout, role }, data, paletteCards, systemCards] = await Promise.all([
    loadDashboardLayout(ctx),
    loadDashboardMetrics(ctx, today),
    loadCardsForPalette(ctx),
    ensureSystemCards(ctx),
  ])

  // Pre-render *every* registered widget so the user can drop any of them
  // onto the canvas without a server round-trip. Only the ones present in the
  // layout actually mount, but having the nodes ready means React's reconciler
  // can attach them instantly when the user clicks "Add" in the palette.
  const nodes: Record<string, React.ReactNode> = {}
  for (const id of Object.keys(WIDGETS)) {
    nodes[id] = (
      <WidgetCard
        widgetId={id}
        data={data}
        todayIso={todayIso}
        quickActions={layout.quickActions}
      />
    )
  }

  // Headline analytics tiles are backed by Insights system cards — override their
  // node with the real card render so the edit canvas matches the live dashboard
  // (and shows the SAME real data, never the retired bespoke computation).
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

  // Pre-render the Insights cards already placed on the layout (newly-added ones
  // render after Save). The library list feeds the palette's "From your library".
  const cardById = new Map(paletteCards.map((c) => [c.id, c]))
  const placedCards = layout.widgets
    .filter((w) => !(w.id in WIDGETS) && UUID_RE.test(w.id))
    .map((w) => cardById.get(w.id))
    .filter((c) => c != null)
  if (placedCards.length) {
    const renders = await loadDashboardCardRenders(ctx, placedCards)
    for (const r of renders) nodes[r.id] = <CardCell key={r.id} render={r} />
  }
  // Palette is permission-gated to match the live dashboard: a self-tier user is
  // only offered personal widgets, and the Insights library only when they have
  // analytics access — so they can't add a card that the view-mode filter drops.
  const allowedWidgetIds = Object.keys(WIDGETS).filter((id) => canSeeWidget(ctx, id))
  const libraryCards = canViewInsights(ctx)
    ? paletteCards.map((c) => ({ id: c.id, name: c.name, description: c.description ?? '' }))
    : []

  return (
    <PageContainer>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-teal-700 dark:text-slate-400 dark:hover:text-teal-300"
            >
              <ArrowLeft size={12} />
              Back to dashboard
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
              Customise your dashboard
            </h1>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Tailored to your role: {ROLE_TIER_LABELS[role]}. Drag tiles, resize from any corner,
              add widgets or your saved Insights cards from the palette, or reset to the default.
            </p>
          </div>
        </div>

        <DashboardGrid
          initialLayout={layout}
          nodes={nodes}
          role={role}
          mode="edit"
          libraryCards={libraryCards}
          allowedWidgetIds={allowedWidgetIds}
        />
      </div>
    </PageContainer>
  )
}
