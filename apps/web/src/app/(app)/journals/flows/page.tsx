import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export const metadata = { title: 'Journal automations' }
export const dynamic = 'force-dynamic'

export default function JournalsFlowsPage() {
  return <ModuleFlowsPage moduleKey="journals" />
}
