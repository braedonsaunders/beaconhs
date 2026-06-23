import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export const metadata = { title: 'Training automations' }
export const dynamic = 'force-dynamic'

export default function TrainingFlowsPage() {
  return <ModuleFlowsPage moduleKey="training" />
}
