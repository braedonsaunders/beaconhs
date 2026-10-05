// PPE sub-nav — a thin delegate to the shared, registry-driven <ModuleNav>.
// Operational tabs (Records, Inspections) + a Manage pill; the admin config (types, criteria
// banks) lives in /ppe/manage.

import { ModuleNav } from '@/components/module-admin/module-nav'

type PpeSubNavKey = 'records' | 'inspections' | 'types' | 'banks'

export function PpeSubNav({ active }: { active: PpeSubNavKey }) {
  return <ModuleNav moduleKey="ppe" active={active} />
}
