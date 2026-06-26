// Equipment check-in/out Station settings — one row per tenant. Drives the
// unified scan-gun station (/equipment/station), the mounted-tablet kiosk
// (/equipment-kiosk?t=<slug>) and the toggle semantics shared by both.
//
// "Checked in" is a location concept: an asset is at base when it sits at a
// org-unit flagged `is_equipment_base` (see org.ts) with no holder. Check-in
// snaps the asset back to `defaultCheckInOrgUnitId` so operators never have to
// pick the home location every time. A missing row = built-in defaults.

import { boolean, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants } from './core'
import { orgUnits } from './org'

// toggle  → one scan flips the asset's state (in ⇄ out). Fastest crib flow.
// explicit→ the operator picks a direction; scans only ever do that action.
export const equipmentScanMode = pgEnum('equipment_scan_mode', ['toggle', 'explicit'])

export const equipmentStationSettings = pgTable(
  'equipment_station_settings',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // Home location an item returns to on check-in. Auto-applied so the operator
    // never picks it. Should be one of the `is_equipment_base` org-units.
    defaultCheckInOrgUnitId: uuid('default_check_in_org_unit_id').references(() => orgUnits.id, {
      onDelete: 'set null',
    }),
    // Hashed PIN for the public mounted-tablet kiosk. Null disables the public
    // kiosk (the in-app station is always available to permitted users).
    stationPin: text('station_pin'),
    scanMode: equipmentScanMode('scan_mode').default('toggle').notNull(),
    // Require a holder (person) be set before an asset can be checked out.
    requireHolderOnCheckout: boolean('require_holder_on_checkout').default(false).notNull(),
    // Force a return-condition prompt on check-in instead of defaulting to good.
    requireConditionOnCheckin: boolean('require_condition_on_checkin').default(false).notNull(),
    // Audible beep + flash on each scan (toggle for quiet environments).
    soundEnabled: boolean('sound_enabled').default(true).notNull(),
    ...timestamps,
  },
  (t) => ({
    uniq: uniqueIndex('equipment_station_settings_uniq').on(t.tenantId),
  }),
)
