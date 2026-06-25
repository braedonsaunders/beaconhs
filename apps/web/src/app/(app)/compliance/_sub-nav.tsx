// Compliance hub tabs — the shared <ModuleSubNav> pill strip (matches every
// other module + handles dark mode). Path-segment driven (real sub-routes).

import { ModuleSubNav } from '@/components/module-admin/module-sub-nav'

const TABS = [
  { key: 'overview', label: 'Overview', href: '/compliance' },
  { key: 'obligations', label: 'Obligations', href: '/compliance/obligations' },
  { key: 'by-person', label: 'By person', href: '/compliance/by-person' },
  { key: 'aging', label: 'Aging', href: '/compliance/aging' },
  { key: 'expiring', label: 'Due & expiring', href: '/compliance/expiring' },
  { key: 'mine', label: 'Mine', href: '/compliance/mine' },
]

export type ComplianceTab =
  | 'overview'
  | 'obligations'
  | 'by-person'
  | 'aging'
  | 'expiring'
  | 'mine'

export function ComplianceSubNav({ active }: { active: ComplianceTab }) {
  return <ModuleSubNav tabs={TABS} active={active} />
}
