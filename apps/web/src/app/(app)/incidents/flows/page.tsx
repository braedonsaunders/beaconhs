import { getGeneratedTranslations } from '@/i18n/generated.server'
import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_03cf9284cbd36d') }
}
export const dynamic = 'force-dynamic'

export default function IncidentsFlowsPage() {
  return <ModuleFlowsPage moduleKey="incidents" />
}
