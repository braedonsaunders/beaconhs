import { getGeneratedTranslations } from '@/i18n/generated.server'
import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1badb8f536b228') }
}
export const dynamic = 'force-dynamic'

export default function DocumentsFlowsPage() {
  return <ModuleFlowsPage moduleKey="documents" />
}
