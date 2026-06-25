// Equipment sub-nav — a thin delegate to the shared, registry-driven <ModuleNav>.
// Operational tabs (register, work orders, truck log, inspections, check-in/out,
// log) + a Manage pill; the admin taxonomies (types, categories, inspection
// types) live in /equipment/manage. Reporting lives in the global reports
// engine (/reports); equipment financials are owned by a separate financial
// system, not this app.

import { ModuleNav } from '@/components/module-admin/module-nav'

export type EquipmentSubNavKey =
  | 'equipment'
  | 'work-orders'
  | 'truck-log'
  | 'inspections'
  | 'log'
  | 'check-out'
  | 'types'
  | 'categories'
  | 'inspection-types'

export function EquipmentSubNav({ active }: { active: EquipmentSubNavKey }) {
  return <ModuleNav moduleKey="equipment" active={active} />
}
