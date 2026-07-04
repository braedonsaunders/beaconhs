// Locations sub-nav — a thin delegate to the shared, registry-driven <ModuleNav>.
// The Locations tab + a Manage pill; the admin surfaces (org units, custom
// fields) live under /locations/manage.

import { ModuleNav } from '@/components/module-admin/module-nav'

export type LocationsNavSection = 'locations' | 'units' | 'custom-fields'

export function LocationsSubNav({ active }: { active: LocationsNavSection }) {
  return <ModuleNav moduleKey="locations" active={active} />
}
