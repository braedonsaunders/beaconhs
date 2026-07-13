// Corrective-actions sub-nav — operational-only (records + the four roll-up
// reports), so it renders the shared <ModuleSubNav> directly with no Manage pill:
// CA has no taxonomies/config to administer, so it has no /manage hub.

import { ModuleSubNav } from '@/components/module-admin/module-sub-nav'

type CorrectiveActionsSubNavKey = 'records' | 'overdue' | 'by-source' | 'by-assignee' | 'aging'

const TABS = [
  { key: 'records', label: 'Records', href: '/corrective-actions' },
  { key: 'overdue', label: 'Overdue', href: '/corrective-actions/reports/overdue' },
  { key: 'by-source', label: 'By source', href: '/corrective-actions/reports/by-source' },
  { key: 'by-assignee', label: 'By assignee', href: '/corrective-actions/reports/by-assignee' },
  { key: 'aging', label: 'Aging', href: '/corrective-actions/reports/aging' },
]

export function CorrectiveActionsSubNav({ active }: { active: CorrectiveActionsSubNavKey }) {
  return <ModuleSubNav tabs={TABS} active={active} />
}
