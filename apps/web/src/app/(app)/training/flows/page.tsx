import { getGeneratedTranslations } from '@/i18n/generated.server'
import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_078ccb8b6c0692') }
}
export const dynamic = 'force-dynamic'

export default function TrainingFlowsPage() {
  return <ModuleFlowsPage moduleKey="training" />
}
