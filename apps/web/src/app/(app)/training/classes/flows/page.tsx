import { getGeneratedTranslations } from '@/i18n/generated.server'
import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_18a6a0a9c67f77') }
}
export const dynamic = 'force-dynamic'

export default function TrainingClassesFlowsPage() {
  return <ModuleFlowsPage moduleKey="training-classes" />
}
