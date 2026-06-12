// Confined-space sub-nav — operational-only (permits + the sensor register), so
// it renders the shared <ModuleSubNav> directly with no Manage pill: confined
// space has no taxonomies/config to administer, so it isn't in MODULE_ADMIN.

import { ModuleSubNav } from '@/components/module-admin/module-sub-nav'

const TABS = [
  { key: 'permits', label: 'Permits', href: '/confined-space' },
  { key: 'sensors', label: 'Atmospheric sensors', href: '/confined-space/sensors' },
]

export function ConfinedSpaceSubNav({ active }: { active: 'permits' | 'sensors' }) {
  return <ModuleSubNav tabs={TABS} active={active} />
}
