import { redirect } from 'next/navigation'
import { requireRequestContext } from '@/lib/auth'
import { canCreateInsights } from '../../_access'
import { loadMetricCards, loadStudioEntities } from '../_data'
import { CardStudio } from '../_studio/card-studio.client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'New card · Insights' }

export default async function NewCardPage() {
  const ctx = await requireRequestContext()
  if (!canCreateInsights(ctx)) redirect('/insights')
  const [metrics, entities] = await Promise.all([loadMetricCards(ctx), loadStudioEntities(ctx)])
  return (
    <CardStudio
      initial={{ name: 'Untitled card', query: null, vizType: 'table' }}
      entities={entities}
      metrics={metrics}
    />
  )
}
