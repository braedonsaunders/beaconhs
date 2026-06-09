// PPE sub-nav — a thin delegate to the shared, registry-driven <ModuleNav>.
// Operational tabs (Records / Issue / Reports) + a Manage pill; the admin config
// (types, inspection criteria) lives in /ppe/manage.

import { ModuleNav } from '@/components/module-admin/module-nav'

export type PpeSubNavKey = 'records' | 'types' | 'inspection-criteria' | 'issue' | 'reports'

export function PpeSubNav({ active }: { active: PpeSubNavKey }) {
  return <ModuleNav moduleKey="ppe" active={active} />
}
