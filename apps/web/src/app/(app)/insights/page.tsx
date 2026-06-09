import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { loadDashboards, loadInsightsData } from './_data'
import { InsightsWorkspace } from './_workspace'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Insights' }

export default async function InsightsPage() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'reports.read')) redirect('/dashboard')

  const [dashboards, data] = await Promise.all([loadDashboards(ctx), loadInsightsData(ctx)])

  return <InsightsWorkspace initialDashboards={dashboards} data={data} />
}
