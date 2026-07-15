import { getGeneratedTranslations } from '@/i18n/generated.server'
import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0e19caa3c1e68a') }
}
export const dynamic = 'force-dynamic'

export default function EquipmentAssetFlowsPage() {
  return <ModuleFlowsPage moduleKey="equipment-assets" />
}
