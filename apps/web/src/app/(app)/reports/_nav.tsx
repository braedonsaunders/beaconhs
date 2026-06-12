// Reports module tab strip — same ModuleSubNav pill pattern every other
// module home uses. Reports is cross-module so it isn't in MODULE_ADMIN;
// the tabs live here.

import { ModuleSubNav } from '@/components/module-admin/module-sub-nav'

export const REPORTS_TABS = [
  { key: 'overview', label: 'Overview', href: '/reports' },
  { key: 'library', label: 'Library', href: '/reports/definitions' },
  { key: 'schedules', label: 'Schedules', href: '/reports/schedules' },
]

export function ReportsSubNav({ active }: { active: 'overview' | 'library' | 'schedules' }) {
  return <ModuleSubNav tabs={REPORTS_TABS} active={active} />
}
