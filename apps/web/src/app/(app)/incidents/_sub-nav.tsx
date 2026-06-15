// Incidents sub-nav — a thin delegate to the shared, registry-driven <ModuleNav>.
// Operational tab (Records) + a Manage pill on operational pages; the admin
// taxonomies (classifications, injury types, hours) live in /incidents/manage.
// Incident reporting lives in the global /reports + /insights engines.
// Kept as a route-local named export so existing call sites need no changes.

import { ModuleNav } from '@/components/module-admin/module-nav'

export type IncidentsSubNavKey = 'records' | 'classifications' | 'injury-types' | 'hours'

export function IncidentsSubNav({ active }: { active: IncidentsSubNavKey }) {
  return <ModuleNav moduleKey="incidents" active={active} />
}
