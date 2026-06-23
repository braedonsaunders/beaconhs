import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export const metadata = { title: 'Equipment automations' }
export const dynamic = 'force-dynamic'

export default function EquipmentFlowsPage() {
  return <ModuleFlowsPage moduleKey="equipment" />
}
