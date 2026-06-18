import { redirect } from 'next/navigation'
import { discoverEntities } from '@beaconhs/analytics/server'
import { requireRequestContext } from '@/lib/auth'
import { canCreateInsights } from '../../_access'
import { loadMetricCards } from '../_data'
import { CardStudio } from '../_studio/card-studio.client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'New card · Insights' }

export default async function NewCardPage() {
  const ctx = await requireRequestContext()
  if (!canCreateInsights(ctx)) redirect('/insights')
  const metrics = await loadMetricCards(ctx)
  return (
    <CardStudio
      initial={{ name: 'Untitled card', query: null, vizType: 'table' }}
      entities={discoverEntities()}
      metrics={metrics}
    />
  )
}
