// Reports module tab strip — same ModuleSubNav pill pattern every other
// module home uses. Reports is cross-module so it isn't in MODULE_ADMIN;
// the tabs live here. The old Library tab merged into the /reports hub.

import { ModuleSubNav } from '@/components/module-admin/module-sub-nav'

const REPORTS_TABS = [
  { key: 'reports', label: 'Reports', href: '/reports' },
  { key: 'schedules', label: 'Schedules', href: '/reports/schedules' },
]

export function ReportsSubNav({ active }: { active: 'reports' | 'schedules' }) {
  return <ModuleSubNav tabs={REPORTS_TABS} active={active} />
}
