// Inspections sub-nav — a thin delegate to the shared, registry-driven <ModuleNav>.
// Operational tabs (Form-driven / Records) + a Manage pill; the admin config
// (types, criteria banks) lives in /inspections/manage.

import { ModuleNav } from '@/components/module-admin/module-nav'

export type InspectionsSubNavKey = 'form-driven' | 'records' | 'types' | 'banks'

export function InspectionsSubNav({ active }: { active: InspectionsSubNavKey }) {
  return <ModuleNav moduleKey="inspections" active={active} />
}
