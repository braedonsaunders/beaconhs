import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export const metadata = { title: 'Corrective action automations' }
export const dynamic = 'force-dynamic'

export default function CorrectiveActionsFlowsPage() {
  return <ModuleFlowsPage moduleKey="corrective-actions" />
}
