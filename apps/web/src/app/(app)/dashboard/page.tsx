import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { loadDashboardMetrics } from './_metrics'
import { loadDashboardLayout } from './_load-layout'
import { ROLE_TIER_LABELS } from './_role-tier'
import { DashboardGrid } from './_dashboard-grid'
import { WidgetCard } from './_widget-views'
import { WIDGETS } from './_widget-registry'
import { DashboardHeader } from './_dashboard-header'

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

  const [{ layout, role, isCustomised }, data] = await Promise.all([
    loadDashboardLayout(ctx),
    loadDashboardMetrics(ctx, today),
  ])

  // Pre-render every widget into a serialisable map keyed by id. Doing this
  // in the RSC keeps each card a pure JSX subtree we can ship to the client.
  const nodes: Record<string, React.ReactNode> = {}
  for (const w of layout.widgets) {
    if (!(w.id in WIDGETS)) continue
    nodes[w.id] = <WidgetCard key={w.id} widgetId={w.id} data={data} todayIso={todayIso} />
  }

  const greeting = buildGreeting(today, ctx.membership?.displayName ?? null)
  const tenantSummary = `${data.peopleCount.toLocaleString()} active people · ${
    data.incidents30
  } incident${data.incidents30 === 1 ? '' : 's'} in the last 30 days`

  return (
    <PageContainer>
      <div className="space-y-5">
        <DashboardHeader
          greeting={greeting}
          tenantSummary={tenantSummary}
          asOf={today.toLocaleString()}
          roleLabel={ROLE_TIER_LABELS[role]}
          isCustomised={isCustomised}
        />

        <DashboardGrid initialLayout={layout} nodes={nodes} role={role} mode="view" />
      </div>
    </PageContainer>
  )
}

function buildGreeting(now: Date, name: string | null): string {
  const hour = now.getHours()
  const stem =
    hour < 5
      ? 'Working late'
      : hour < 12
        ? 'Good morning'
        : hour < 17
          ? 'Good afternoon'
          : hour < 21
            ? 'Good evening'
            : 'Burning the midnight oil'
  const firstName = name?.split(/\s+/)[0]
  return firstName ? `${stem}, ${firstName}.` : `${stem}.`
}
