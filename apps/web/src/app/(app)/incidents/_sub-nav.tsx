// Incidents sub-nav — a thin delegate to the shared, registry-driven <ModuleNav>.
// Operational tabs (Records / Reports) + a Manage pill on operational pages; the
// admin taxonomies (classifications, injury types, hours) live in /incidents/manage.
// Kept as a route-local named export so existing call sites need no changes.

import { ModuleNav } from '@/components/module-admin/module-nav'

export type IncidentsSubNavKey =
  | 'records'
  | 'classifications'
  | 'injury-types'
  | 'hours'
  | 'reports'

export function IncidentsSubNav({ active }: { active: IncidentsSubNavKey }) {
  return <ModuleNav moduleKey="incidents" active={active} />
}
