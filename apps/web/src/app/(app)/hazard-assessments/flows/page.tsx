import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export const metadata = { title: 'Hazard assessment automations' }
export const dynamic = 'force-dynamic'

export default function HazidFlowsPage() {
  return <ModuleFlowsPage moduleKey="hazid" />
}
