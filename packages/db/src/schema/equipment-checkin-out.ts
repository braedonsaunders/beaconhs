// Equipment check-out history — paired check-out / check-in rows that track
// who had a specific asset out, when they took it, when (or whether) they
// returned it, and what condition it came back in. Distinct from
// equipment_location_history (which is a structural snapshot of where an
// item is) — this table is the accountability ledger.
//
// A row with `returnedAt` IS NULL means the item is currently out.

import { relations, sql } from 'drizzle-orm'
import {
  date,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
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
    equipmentItemId: uuid('equipment_item_id').notNull(),
    // Person physically taking the asset.
    holderPersonId: uuid('holder_person_id'),
    // Optional destination — site / project the asset is going to.
    destinationOrgUnitId: uuid('destination_org_unit_id'),
    checkedOutAt: timestamp('checked_out_at', { withTimezone: true }).defaultNow().notNull(),
    expectedReturnOn: date('expected_return_on'),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    returnedCondition: equipmentCheckoutCondition('returned_condition'),
    returnedNotes: text('returned_notes'),
    notes: text('notes'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    checkedOutByTenantUserId: uuid('checked_out_by_tenant_user_id'),
    checkedInByTenantUserId: uuid('checked_in_by_tenant_user_id'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('equipment_checkouts_tenant_idx').on(t.tenantId),
    itemIdx: index('equipment_checkouts_item_idx').on(
      t.tenantId,
      t.equipmentItemId,
      t.checkedOutAt,
    ),
    openIdx: index('equipment_checkouts_open_idx').on(t.tenantId, t.returnedAt),
    // A null return timestamp is the durable "currently checked out" state.
    // Application row locks serialize the normal workflow; this partial key
    // is the final backstop for every writer, including imports and retries.
    openItemUx: uniqueIndex('equipment_checkouts_open_item_ux')
      .on(t.tenantId, t.equipmentItemId)
      .where(sql`${t.returnedAt} is null`),
    holderIdx: index('equipment_checkouts_holder_idx').on(t.tenantId, t.holderPersonId),
    destinationIdx: index('equipment_checkouts_destination_idx').on(
      t.tenantId,
      t.destinationOrgUnitId,
    ),
    checkedOutByIdx: index('equipment_checkouts_checked_out_by_idx').on(
      t.tenantId,
      t.checkedOutByTenantUserId,
    ),
    checkedInByIdx: index('equipment_checkouts_checked_in_by_idx').on(
      t.tenantId,
      t.checkedInByTenantUserId,
    ),
    itemFk: foreignKey({
      name: 'equipment_checkouts_tenant_item_fk',
      columns: [t.tenantId, t.equipmentItemId],
      foreignColumns: [equipmentItems.tenantId, equipmentItems.id],
    }).onDelete('cascade'),
    holderFk: foreignKey({
      name: 'equipment_checkouts_tenant_holder_fk',
      columns: [t.tenantId, t.holderPersonId],
      foreignColumns: [people.tenantId, people.id],
    }),
    destinationFk: foreignKey({
      name: 'equipment_checkouts_tenant_destination_fk',
      columns: [t.tenantId, t.destinationOrgUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id],
    }),
    checkedOutByFk: foreignKey({
      name: 'equipment_checkouts_tenant_checked_out_by_fk',
      columns: [t.tenantId, t.checkedOutByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    checkedInByFk: foreignKey({
      name: 'equipment_checkouts_tenant_checked_in_by_fk',
      columns: [t.tenantId, t.checkedInByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
  }),
)

export const equipmentCheckoutsRelations = relations(equipmentCheckouts, ({ one }) => ({
  tenant: one(tenants, { fields: [equipmentCheckouts.tenantId], references: [tenants.id] }),
  item: one(equipmentItems, {
    fields: [equipmentCheckouts.tenantId, equipmentCheckouts.equipmentItemId],
    references: [equipmentItems.tenantId, equipmentItems.id],
  }),
  holder: one(people, {
    fields: [equipmentCheckouts.tenantId, equipmentCheckouts.holderPersonId],
    references: [people.tenantId, people.id],
  }),
  destination: one(orgUnits, {
    fields: [equipmentCheckouts.tenantId, equipmentCheckouts.destinationOrgUnitId],
    references: [orgUnits.tenantId, orgUnits.id],
  }),
}))
