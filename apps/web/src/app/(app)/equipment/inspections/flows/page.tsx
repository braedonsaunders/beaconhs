import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export const metadata = { title: 'Equipment inspection automations' }
export const dynamic = 'force-dynamic'

export default function EquipmentInspectionsFlowsPage() {
  return <ModuleFlowsPage moduleKey="equipment-inspections" />
}
