// People sub-nav — a thin delegate to the shared, registry-driven <ModuleNav>.
// The Directory tab + a Manage pill; the admin org structure (departments,
// groups, job titles, org chart) lives in /people/manage.

import { ModuleNav } from '@/components/module-admin/module-nav'

export type PeopleNavSection =
  | 'directory'
  | 'org-chart'
  | 'groups'
  | 'departments'
  | 'titles'
  | 'trades'
  | 'crews'

export function PeopleSubNav({ active }: { active: PeopleNavSection }) {
  return <ModuleNav moduleKey="people" active={active} />
}
