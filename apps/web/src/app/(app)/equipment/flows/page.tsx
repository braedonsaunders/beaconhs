import { getGeneratedTranslations } from '@/i18n/generated.server'
import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1949354b18a78f') }
}
export const dynamic = 'force-dynamic'

export default function EquipmentFlowsPage() {
  return <ModuleFlowsPage moduleKey="equipment" />
}
