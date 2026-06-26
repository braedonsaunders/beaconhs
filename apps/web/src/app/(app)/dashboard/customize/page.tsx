import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { loadDashboardLayout } from '../_load-layout'
import { ROLE_TIER_LABELS } from '../_role-tier'
import { DashboardGrid } from '../_dashboard-grid'
import { WIDGETS } from '../_widget-registry'
import { canSeeWidget } from '../_widget-access'
import { canViewInsights } from '../../insights/_access'
import { loadDashboardEditCanvas } from '../_edit-canvas'

export const metadata = { title: 'Customise Dashboard' }
export const dynamic = 'force-dynamic'

export default async function CustomiseDashboardPage() {
  const ctx = await requireRequestContext()
  const { layout, role } = await loadDashboardLayout(ctx)
  const { nodes, libraryCards } = await loadDashboardEditCanvas(ctx, layout, {
    includeLibraryCards: canViewInsights(ctx),
  })
  // Palette is permission-gated to match the live dashboard: a self-tier user is
  // only offered personal widgets, and the Insights library only when they have
  // analytics access — so they can't add a card that the view-mode filter drops.
  const allowedWidgetIds = Object.keys(WIDGETS).filter((id) => canSeeWidget(ctx, id))

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
          key={`${role}:${JSON.stringify(layout.widgets)}`}
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
