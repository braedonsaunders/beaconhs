import { getGeneratedTranslations } from '@/i18n/generated.server'
import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1f5e0e833c4f45') }
}
export const dynamic = 'force-dynamic'

export default function HazidFlowsPage() {
  return <ModuleFlowsPage moduleKey="hazid" />
}
