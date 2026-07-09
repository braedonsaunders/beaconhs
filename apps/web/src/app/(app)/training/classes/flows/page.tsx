import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export const metadata = { title: 'Training class automations' }
export const dynamic = 'force-dynamic'

export default function TrainingClassesFlowsPage() {
  return <ModuleFlowsPage moduleKey="training-classes" />
}
