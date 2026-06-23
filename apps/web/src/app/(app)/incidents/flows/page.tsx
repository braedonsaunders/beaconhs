import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export const metadata = { title: 'Incident automations' }
export const dynamic = 'force-dynamic'

export default function IncidentsFlowsPage() {
  return <ModuleFlowsPage moduleKey="incidents" />
}
