// Reports module tab strip — same ModuleSubNav pill pattern every other
// module home uses. Reports is cross-module so it isn't in MODULE_ADMIN;
// the tabs live here. AI briefs show only to people who may read them.

import { ModuleSubNav } from '@/components/module-admin/module-sub-nav'
import { requireRequestContext } from '@/lib/auth'
import { canReadBriefs } from '@/lib/briefs/access'

const REPORTS_TABS = [
  { key: 'reports', label: 'Reports', href: '/reports' },
  { key: 'schedules', label: 'Schedules', href: '/reports/schedules' },
  { key: 'briefs', label: 'AI briefs', href: '/reports/briefs' },
]

export async function ReportsSubNav({ active }: { active: 'reports' | 'schedules' | 'briefs' }) {
  const ctx = await requireRequestContext()
  const tabs = canReadBriefs(ctx) ? REPORTS_TABS : REPORTS_TABS.filter((t) => t.key !== 'briefs')
  return <ModuleSubNav tabs={tabs} active={active} />
}
