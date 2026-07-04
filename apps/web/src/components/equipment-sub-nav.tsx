// Equipment sub-nav — a thin delegate to the shared, registry-driven <ModuleNav>.
// Operational tabs (register, check-in/out, work orders, vehicle log,
// inspections) + a Manage pill; the admin taxonomies (types, categories,
// inspection types) live in /equipment/manage. The per-asset activity log is
// only on an individual equipment record, not a module tab. Reporting lives in
// the global reports engine (/reports); equipment financials are owned by a
// separate financial system, not this app.

import { ModuleNav } from '@/components/module-admin/module-nav'

export type EquipmentSubNavKey =
  | 'equipment'
  | 'maintenance'
  | 'work-orders'
  | 'vehicle-log'
  | 'inspections'
  | 'station'
  | 'station-settings'
  | 'types'
  | 'categories'
  | 'inspection-types'

export function EquipmentSubNav({ active }: { active: EquipmentSubNavKey }) {
  return <ModuleNav moduleKey="equipment" active={active} />
}
