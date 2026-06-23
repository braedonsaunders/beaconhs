import { ModuleFlowsPage } from '@/components/flows/module-flows-page'

export const metadata = { title: 'Document automations' }
export const dynamic = 'force-dynamic'

export default function DocumentsFlowsPage() {
  return <ModuleFlowsPage moduleKey="documents" />
}
