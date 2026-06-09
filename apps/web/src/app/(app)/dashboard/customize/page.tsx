import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { loadDashboardMetrics } from '../_metrics'
import { loadDashboardLayout } from '../_load-layout'
import { ROLE_TIER_LABELS } from '../_role-tier'
import { DashboardGrid } from '../_dashboard-grid'
import { WidgetCard } from '../_widget-views'
import { WIDGETS } from '../_widget-registry'

export const metadata = { title: 'Customise Dashboard' }
export const dynamic = 'force-dynamic'

export default async function CustomiseDashboardPage() {
  const ctx = await requireRequestContext()
  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)

  const [{ layout, role }, data] = await Promise.all([
    loadDashboardLayout(ctx),
    loadDashboardMetrics(ctx, today),
  ])

  // Pre-render *every* registered widget so the user can drop any of them
  // onto the canvas without a server round-trip. Only the ones present in the
  // layout actually mount, but having the nodes ready means React's reconciler
  // can attach them instantly when the user clicks "Add" in the palette.
  const nodes: Record<string, React.ReactNode> = {}
  for (const id of Object.keys(WIDGETS)) {
    nodes[id] = <WidgetCard widgetId={id} data={data} todayIso={todayIso} />
  }

  return (
    <PageContainer>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 transition hover:text-teal-700 dark:hover:text-teal-300"
            >
              <ArrowLeft size={12} />
              Back to dashboard
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
              Customise your dashboard
            </h1>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Tailored to your role: {ROLE_TIER_LABELS[role]}. Drag tiles, resize
              from any corner, add new widgets from the palette, or reset to the
              default layout for your role.
            </p>
          </div>
        </div>

        <DashboardGrid
          initialLayout={layout}
          nodes={nodes}
          role={role}
          mode="edit"
        />
      </div>
    </PageContainer>
  )
}
