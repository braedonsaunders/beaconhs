import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export const metadata = { title: 'PPE inspection automations' }
export const dynamic = 'force-dynamic'

export default function PpeFlowsPage() {
  return <ModuleFlowsPage moduleKey="ppe" />
}
