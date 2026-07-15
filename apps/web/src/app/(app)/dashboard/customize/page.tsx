import { getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_17e6fb8b7201b5') }
}
export const dynamic = 'force-dynamic'

export default async function CustomiseDashboardPage() {
  const ctx = await requireRequestContext()
  const { layout, role } = await loadDashboardLayout(ctx)
  // Same security gate as view mode (dashboard/page.tsx): drop org widgets the
  // viewer may not see BEFORE rendering the canvas — otherwise a saved/injected
  // layout would surface real org data in edit mode that view mode hides.
  const visibleLayout = {
    ...layout,
    widgets: layout.widgets.filter((w) => canSeeWidget(ctx, w.id)),
  }
  // Palette is permission-gated to match the live dashboard: a self-tier user is
  // only offered personal widgets, and the Insights library only when they have
  // analytics access — so they can't add a card that the view-mode filter drops.
  const allowedWidgetIds = Object.keys(WIDGETS).filter((id) => canSeeWidget(ctx, id))
  const { nodes, libraryCards } = await loadDashboardEditCanvas(ctx, visibleLayout, {
    includeLibraryCards: canViewInsights(ctx),
    allowedWidgetIds: new Set(allowedWidgetIds),
  })

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
              <GeneratedText id="m_0d79c2d48751f6" />
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
              <GeneratedText id="m_0eca9b6b2350eb" />
            </h1>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              <GeneratedText id="m_0d3aa1474d9b46" />{' '}
              <GeneratedValue value={ROLE_TIER_LABELS[role]} />
              <GeneratedText id="m_1608d542b6d6bd" />
            </p>
          </div>
        </div>

        <DashboardGrid
          key={`${role}:${JSON.stringify(visibleLayout.widgets)}`}
          initialLayout={visibleLayout}
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
