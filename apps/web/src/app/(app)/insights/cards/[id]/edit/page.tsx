import { notFound, redirect } from 'next/navigation'
import { requireRequestContext } from '@/lib/auth'
import { canCreateInsights } from '../../../_access'
import { loadCard, loadMetricCards, loadStudioEntities } from '../../_data'
import { CardStudio } from '../../_studio/card-studio.client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Edit card · Insights' }

export default async function EditCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()
  if (!canCreateInsights(ctx)) redirect('/insights')
  const card = await loadCard(ctx, id)
  if (!card) notFound()
  const [metrics, entities] = await Promise.all([loadMetricCards(ctx), loadStudioEntities(ctx)])
  return (
    <CardStudio
      initial={{
        id: card.id,
        name: card.name,
        query: card.query,
        vizType: card.vizType,
        vizSettings: card.vizSettings,
        kind: card.kind,
        config: card.config,
      }}
      entities={entities}
      metrics={metrics}
    />
  )
}
