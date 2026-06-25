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

export type ComplianceTab = 'overview' | 'obligations' | 'by-person' | 'aging' | 'expiring' | 'mine'

// `canReadAll` = the viewer holds `compliance.read` (the org-wide hub). Without
// it, a person only ever sees their own obligations, so we hide the org tabs and
// leave just "Mine" — the only page they can open.
export function ComplianceSubNav({
  active,
  canReadAll = true,
}: {
  active: ComplianceTab
  canReadAll?: boolean
}) {
  const tabs = canReadAll ? TABS : TABS.filter((t) => t.key === 'mine')
  return <ModuleSubNav tabs={tabs} active={active} />
}
