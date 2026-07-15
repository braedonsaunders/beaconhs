import { getGeneratedTranslations } from '@/i18n/generated.server'
import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_01294da13ed72a') }
}
export const dynamic = 'force-dynamic'

export default function VehicleLogFlowsPage() {
  return <ModuleFlowsPage moduleKey="vehicle-log" />
}
