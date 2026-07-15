import { getGeneratedTranslations } from '@/i18n/generated.server'
import { notFound, redirect } from 'next/navigation'
import { requireRequestContext } from '@/lib/auth'
import { canCreateInsights } from '../../../_access'
import { loadCard, loadMetricCards, loadStudioEntities } from '../../_data'
import { CardStudio } from '../../_studio/card-studio.client'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1d2eeab4cb3c29') }
}

export default async function EditCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireRequestContext()
  if (!canCreateInsights(ctx)) redirect('/insights')
  const card = await loadCard(ctx, id)
  if (!card) notFound()
  if (!ctx.isSuperAdmin && card.createdBy !== ctx.userId) notFound()
  const [metrics, entities] = await Promise.all([loadMetricCards(ctx), loadStudioEntities(ctx)])
  return (
    <CardStudio
      initial={{
        id: card.id,
        name: card.name,
        description: card.description,
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
