// People sub-nav — a thin delegate to the shared, registry-driven <ModuleNav>.
// Operational tabs (Directory / Org chart) + a Manage pill; the admin org
// structure (groups, divisions, job titles) lives in /people/manage.

import { ModuleNav } from '@/components/module-admin/module-nav'

export type PeopleNavSection = 'directory' | 'org-chart' | 'groups' | 'divisions' | 'titles'

export function PeopleSubNav({ active }: { active: PeopleNavSection }) {
  return <ModuleNav moduleKey="people" active={active} />
}
