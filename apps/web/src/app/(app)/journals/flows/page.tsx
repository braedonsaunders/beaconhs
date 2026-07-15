import { getGeneratedTranslations } from '@/i18n/generated.server'
import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_17a2e80bd28302') }
}
export const dynamic = 'force-dynamic'

export default function JournalsFlowsPage() {
  return <ModuleFlowsPage moduleKey="journals" />
}
