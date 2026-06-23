import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export const metadata = { title: 'Inspection automations' }
export const dynamic = 'force-dynamic'

export default function InspectionsFlowsPage() {
  return <ModuleFlowsPage moduleKey="inspections" />
}
