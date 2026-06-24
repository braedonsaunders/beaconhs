// PPE sub-nav — a thin delegate to the shared, registry-driven <ModuleNav>.
// Operational tab (Records) + a Manage pill; the admin config (types, criteria
// banks, inspection-criteria overview) lives in /ppe/manage.

import { ModuleNav } from '@/components/module-admin/module-nav'

export type PpeSubNavKey = 'records' | 'types' | 'banks' | 'inspection-criteria'

export function PpeSubNav({ active }: { active: PpeSubNavKey }) {
  return <ModuleNav moduleKey="ppe" active={active} />
}
