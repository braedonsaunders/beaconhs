// Equipment check-out history — paired check-out / check-in rows that track
// who had a specific asset out, when they took it, when (or whether) they
// returned it, and what condition it came back in. Distinct from
// equipment_location_history (which is a structural snapshot of where an
// item is) — this table is the accountability ledger.
//
// A row with `returnedAt` IS NULL means the item is currently out.

import { relations } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants, tenantUsers } from './core'
import { equipmentItems } from './equipment'
import { orgUnits, people } from './org'

export const equipmentCheckoutCondition = pgEnum('equipment_checkout_condition', [
  'good',
  'fair',
  'damaged',
  'unusable',
])

export const equipmentCheckouts = pgTable(
  'equipment_checkouts',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    equipmentItemId: uuid('equipment_item_id')
      .notNull()
      .references(() => equipmentItems.id, { onDelete: 'cascade' }),
    // Person physically taking the asset.
    holderPersonId: uuid('holder_person_id').references(() => people.id),
    // Optional destination — site / project the asset is going to.
    destinationOrgUnitId: uuid('destination_org_unit_id').references(() => orgUnits.id),
    checkedOutAt: timestamp('checked_out_at', { withTimezone: true }).defaultNow().notNull(),
    expectedReturnOn: date('expected_return_on'),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    returnedCondition: equipmentCheckoutCondition('returned_condition'),
    returnedNotes: text('returned_notes'),
    notes: text('notes'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    checkedOutByTenantUserId: uuid('checked_out_by_tenant_user_id').references(
      () => tenantUsers.id,
    ),
    checkedInByTenantUserId: uuid('checked_in_by_tenant_user_id').references(() => tenantUsers.id),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('equipment_checkouts_tenant_idx').on(t.tenantId),
    itemIdx: index('equipment_checkouts_item_idx').on(t.equipmentItemId, t.checkedOutAt),
    openIdx: index('equipment_checkouts_open_idx').on(t.tenantId, t.returnedAt),
    holderIdx: index('equipment_checkouts_holder_idx').on(t.tenantId, t.holderPersonId),
  }),
)

export const equipmentCheckoutsRelations = relations(equipmentCheckouts, ({ one }) => ({
  tenant: one(tenants, { fields: [equipmentCheckouts.tenantId], references: [tenants.id] }),
  item: one(equipmentItems, {
    fields: [equipmentCheckouts.equipmentItemId],
    references: [equipmentItems.id],
  }),
  holder: one(people, {
    fields: [equipmentCheckouts.holderPersonId],
    references: [people.id],
  }),
  destination: one(orgUnits, {
    fields: [equipmentCheckouts.destinationOrgUnitId],
    references: [orgUnits.id],
  }),
}))
