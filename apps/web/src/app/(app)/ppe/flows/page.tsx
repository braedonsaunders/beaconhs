import { getGeneratedTranslations } from '@/i18n/generated.server'
import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_009b4fd7d03c03') }
}
export const dynamic = 'force-dynamic'

export default function PpeFlowsPage() {
  return <ModuleFlowsPage moduleKey="ppe" />
}
