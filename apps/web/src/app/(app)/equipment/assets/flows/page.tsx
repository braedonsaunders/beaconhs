import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export const metadata = { title: 'Equipment asset automations' }
export const dynamic = 'force-dynamic'

export default function EquipmentAssetFlowsPage() {
  return <ModuleFlowsPage moduleKey="equipment-assets" />
}
