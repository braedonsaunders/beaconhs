import { getGeneratedTranslations } from '@/i18n/generated.server'
import { redirect } from 'next/navigation'
import { requireRequestContext } from '@/lib/auth'
import { canCreateInsights } from '../../_access'
import { loadMetricCards, loadStudioEntities } from '../_data'
import { CardStudio } from '../_studio/card-studio.client'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0b01642f4b1b5e') }
}

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
