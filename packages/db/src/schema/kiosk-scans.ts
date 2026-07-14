// Kiosk scans — sign-in / sign-out events captured at a jobsite kiosk tablet.
// The kiosk itself authenticates by tenant slug + a kiosk PIN stored on the tenant
// (see core.ts → tenants.kioskPin hash). No per-user login needed.

import { relations } from 'drizzle-orm'
import { foreignKey, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
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
    personId: uuid('person_id').notNull(),
    kind: kioskScanKind('kind').notNull(),
    siteOrgUnitId: uuid('site_org_unit_id'),
    crewId: uuid('crew_id'),
    scannedAt: timestamp('scanned_at', { withTimezone: true }).defaultNow().notNull(),
    deviceLabel: text('device_label'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('kiosk_scans_tenant_idx').on(t.tenantId, t.scannedAt),
    personIdx: index('kiosk_scans_person_idx').on(t.tenantId, t.personId, t.scannedAt),
    siteIdx: index('kiosk_scans_site_idx').on(t.tenantId, t.siteOrgUnitId, t.scannedAt),
    crewIdx: index('kiosk_scans_crew_idx').on(t.tenantId, t.crewId, t.scannedAt),
    personFk: foreignKey({
      name: 'kiosk_scans_tenant_person_fk',
      columns: [t.tenantId, t.personId],
      foreignColumns: [people.tenantId, people.id],
    }).onDelete('cascade'),
    siteFk: foreignKey({
      name: 'kiosk_scans_tenant_site_fk',
      columns: [t.tenantId, t.siteOrgUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id],
    }),
    crewFk: foreignKey({
      name: 'kiosk_scans_tenant_crew_fk',
      columns: [t.tenantId, t.crewId],
      foreignColumns: [crews.tenantId, crews.id],
    }),
  }),
)

export const kioskScansRelations = relations(kioskScans, ({ one }) => ({
  tenant: one(tenants, { fields: [kioskScans.tenantId], references: [tenants.id] }),
  person: one(people, {
    fields: [kioskScans.tenantId, kioskScans.personId],
    references: [people.tenantId, people.id],
  }),
  site: one(orgUnits, {
    fields: [kioskScans.tenantId, kioskScans.siteOrgUnitId],
    references: [orgUnits.tenantId, orgUnits.id],
  }),
  crew: one(crews, {
    fields: [kioskScans.tenantId, kioskScans.crewId],
    references: [crews.tenantId, crews.id],
  }),
}))
