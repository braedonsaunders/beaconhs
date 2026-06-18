import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { loadDashboardMetrics } from './_metrics'
import { loadDashboardLayout } from './_load-layout'
import { DashboardGrid } from './_dashboard-grid'
import { WidgetCard } from './_widget-views'
import { WIDGETS } from './_widget-registry'
import { DashboardHeader } from './_dashboard-header'
import { loadCardsForPalette } from '../insights/cards/_data'
import { loadDashboardCardRenders } from '../insights/_data'
import { CardCell } from '../insights/_viz/card-cell.client'

const UUID_RE = /^[0-9a-f-]{36}$/i

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

  const [{ layout, role }, data] = await Promise.all([
    loadDashboardLayout(ctx),
    loadDashboardMetrics(ctx, today),
  ])

  // A placed widget id is EITHER a bespoke widget key OR a saved Insights card
  // uuid. Run the placed cards through the same engine + viz as /insights (each
  // under its own RLS tx), so a card built once renders on both surfaces.
  const cardIds = layout.widgets
    .filter((w) => !(w.id in WIDGETS) && UUID_RE.test(w.id))
    .map((w) => w.id)
  const renderById = new Map(
    cardIds.length
      ? await (async () => {
          const byId = new Map((await loadCardsForPalette(ctx)).map((c) => [c.id, c]))
          const cards = cardIds.map((id) => byId.get(id)).filter((c) => c != null)
          const renders = await loadDashboardCardRenders(ctx, cards)
          return renders.map((r) => [r.id, r] as const)
        })()
      : [],
  )

  // Pre-render every placed widget into a serialisable map keyed by id. Doing
  // this in the RSC keeps each card a pure JSX subtree we can ship to the client.
  const nodes: Record<string, React.ReactNode> = {}
  for (const w of layout.widgets) {
    if (w.id in WIDGETS) {
      nodes[w.id] = <WidgetCard key={w.id} widgetId={w.id} data={data} todayIso={todayIso} />
    } else {
      const render = renderById.get(w.id)
      if (render) nodes[w.id] = <CardCell key={w.id} render={render} />
    }
  }

  const greeting = buildGreeting(today, ctx.membership?.displayName ?? null)
  const tenantSummary = `${data.peopleCount.toLocaleString()} active people · ${
    data.incidents30
  } incident${data.incidents30 === 1 ? '' : 's'} in the last 30 days`

  return (
    <PageContainer>
      <div className="space-y-5">
        <DashboardHeader greeting={greeting} tenantSummary={tenantSummary} />

        <DashboardGrid initialLayout={layout} nodes={nodes} role={role} mode="view" />
      </div>
    </PageContainer>
  )
}

function buildGreeting(now: Date, name: string | null): string {
  const hour = now.getHours()
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
