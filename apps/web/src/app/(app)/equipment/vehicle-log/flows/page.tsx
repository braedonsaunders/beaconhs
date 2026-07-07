import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export const metadata = { title: 'Vehicle log automations' }
export const dynamic = 'force-dynamic'

export default function VehicleLogFlowsPage() {
  return <ModuleFlowsPage moduleKey="vehicle-log" />
}
