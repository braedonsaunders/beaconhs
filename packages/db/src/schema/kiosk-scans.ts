// Kiosk scans — sign-in / sign-out events captured at a jobsite kiosk tablet.
// The kiosk itself authenticates by tenant slug + a kiosk PIN stored on the tenant
// (see core.ts → tenants.kioskPin hash). No per-user login needed.

import { relations } from 'drizzle-orm'
import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants } from './core'
import { crews, orgUnits, people } from './org'

export const kioskScanKind = pgEnum('kiosk_scan_kind', ['in', 'out'])

export const kioskScans = pgTable(
  'kiosk_scans',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    kind: kioskScanKind('kind').notNull(),
    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id),
    crewId: uuid('crew_id').references(() => crews.id),
    scannedAt: timestamp('scanned_at', { withTimezone: true }).defaultNow().notNull(),
    deviceLabel: text('device_label'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('kiosk_scans_tenant_idx').on(t.tenantId, t.scannedAt),
    personIdx: index('kiosk_scans_person_idx').on(t.tenantId, t.personId, t.scannedAt),
  }),
)

export const kioskScansRelations = relations(kioskScans, ({ one }) => ({
  tenant: one(tenants, { fields: [kioskScans.tenantId], references: [tenants.id] }),
  person: one(people, { fields: [kioskScans.personId], references: [people.id] }),
  site: one(orgUnits, { fields: [kioskScans.siteOrgUnitId], references: [orgUnits.id] }),
  crew: one(crews, { fields: [kioskScans.crewId], references: [crews.id] }),
}))
