import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { loadDashboardMetrics } from './_metrics'
import { loadDashboardLayout } from './_load-layout'
import { DashboardGrid } from './_dashboard-grid'
import { WidgetCard } from './_widget-views'
import { WIDGETS, WIDGET_CARD_KEY } from './_widget-registry'
import { canSeeOrgAggregates, canSeeWidget } from './_widget-access'
import { DashboardHeader } from './_dashboard-header'
import { loadCardsForPalette } from '../insights/cards/_data'
import { loadDashboardCardRenders } from '../insights/_data'
import { ensureSystemCards } from '../insights/_system-cards'
import { CardCell } from '../insights/_viz/card-cell.client'
import { isUuid } from '@/lib/list-params'

export const metadata = { title: 'Dashboard' }
export const dynamic = 'force-dynamic'

/**
 * Dashboard — role-aware, user-customisable.
 *
 *   1. Resolve role tier + load layout (user's saved or role default)
 *   2. Fetch the full metrics payload once
 *   3. Build {widgetId -> JSX} map for every widget present in the layout
 *   4. Hand off to <DashboardGrid mode="view">
 *
 * The grid renders each card from the map at the saved position. The
 * "Customize" CTA in the header navigates to /dashboard/customize where
 * the same grid is rendered in edit mode.
 */
export default async function DashboardPage() {
  const ctx = await requireRequestContext()
  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)

  const [{ layout, role }, data, systemCards] = await Promise.all([
    loadDashboardLayout(ctx),
    loadDashboardMetrics(ctx, today),
    ensureSystemCards(ctx),
  ])

  // Drop org/aggregate cards a self-tier viewer may not see — the security
  // guarantee: a saved/edited/migrated layout can never surface another user's
  // data. Personal widgets always pass; placed Insights cards need analytics
  // access. Everything below renders from `widgets` / `visibleLayout`.
  const widgets = layout.widgets.filter((w) => canSeeWidget(ctx, w.id))
  const visibleLayout = { ...layout, widgets }

  // Every placed widget is EITHER a bespoke widget key, a headline analytics key
  // backed by an Insights system card (WIDGET_CARD_KEY), or a saved library-card
  // uuid. Resolve the latter two to real Cards and run them through the SAME
  // engine + viz as /insights — so the homepage shows identical real data and a
  // card built once renders on both surfaces. Build widgetId -> cardId plus the
  // de-duped set of distinct cards to compile (one render even if placed twice).
  type CardItem = Parameters<typeof loadDashboardCardRenders>[1][number]
  const widgetToCardId = new Map<string, string>()
  const cardsToRun = new Map<string, CardItem>()
  for (const w of widgets) {
    const card = systemCards.get(WIDGET_CARD_KEY[w.id] ?? '')
    if (!card) continue
    widgetToCardId.set(w.id, card.id)
    cardsToRun.set(card.id, { ...card, kind: 'question', config: null })
  }
  const uuidIds = widgets
    .filter((w) => !(w.id in WIDGETS) && !widgetToCardId.has(w.id) && isUuid(w.id))
    .map((w) => w.id)
  if (uuidIds.length > 0) {
    const byId = new Map((await loadCardsForPalette(ctx)).map((c) => [c.id, c]))
    for (const id of uuidIds) {
      const c = byId.get(id)
      if (!c) continue
      widgetToCardId.set(id, c.id)
      cardsToRun.set(c.id, c)
    }
  }
  const renders = await loadDashboardCardRenders(ctx, [...cardsToRun.values()])
  const renderByCardId = new Map(renders.map((r) => [r.id, r] as const))

  // Pre-render every placed widget into a serialisable map keyed by id. Doing
  // this in the RSC keeps each card a pure JSX subtree we can ship to the client.
  const nodes: Record<string, React.ReactNode> = {}
  for (const w of widgets) {
    const cardId = widgetToCardId.get(w.id)
    if (cardId) {
      const render = renderByCardId.get(cardId)
      if (render) nodes[w.id] = <CardCell key={w.id} render={render} />
    } else if (w.id in WIDGETS) {
      nodes[w.id] = (
        <WidgetCard
          key={w.id}
          widgetId={w.id}
          data={data}
          todayIso={todayIso}
          quickActions={layout.quickActions}
        />
      )
    }
  }

  const greeting = buildGreeting(today, ctx.timezone, ctx.membership?.displayName ?? null)
  // The tenant rollup is org data — omit it for self-only viewers (they'd have
  // no org cards either, so the number would be the only leak).
  const tenantSummary = canSeeOrgAggregates(ctx)
    ? `${data.peopleCount.toLocaleString()} active people · ${
        data.incidents30
      } incident${data.incidents30 === 1 ? '' : 's'} in the last 30 days`
    : null

  return (
    <PageContainer>
      <div className="space-y-5">
        <DashboardHeader greeting={greeting} tenantSummary={tenantSummary} />

        <DashboardGrid initialLayout={visibleLayout} nodes={nodes} role={role} mode="view" />
      </div>
    </PageContainer>
  )
}

function buildGreeting(now: Date, timeZone: string, name: string | null): string {
  // Read the hour in the USER's timezone, not the server's. This renders in a
  // Server Component, so a bare now.getHours() uses the deploy container's clock
  // (UTC in prod) and greets "morning" during someone's evening. Mirrors the
  // tz-aware hour read in packages/reports/src/cadence.ts.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const raw = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const hour = raw === 24 ? 0 : raw // some platforms emit '24' for midnight
  const stem = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = firstNameFrom(name)
  return firstName ? `${stem}, ${firstName}` : stem
}

// Display names can arrive as "First Last" or "Last, First" (the employee
// directory convention). Pull the real first name out of either shape.
function firstNameFrom(name: string | null): string | null {
  if (!name) return null
  const trimmed = name.trim()
  const base = trimmed.includes(',') ? (trimmed.split(',')[1] ?? '') : trimmed
  return base.trim().split(/\s+/)[0] || null
}
