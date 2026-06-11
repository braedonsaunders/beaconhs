// Equipment financials — per-equipment-type billing rates (hourly / daily /
// weekly / monthly) and per-equipment-item expense ledger. Drives the ROI
// report, charges report, and the per-item Financials tab.
//
// Rates live on the equipment_type level (one row per type per billing
// cadence), so seven trucks of "Pickup Truck" type share one weekly rate.
// Expenses live on the equipment_item level — they're the actual money out
// (fuel, repairs, insurance, registration, …) tied to a specific asset.

import { relations } from 'drizzle-orm'
import { date, index, jsonb, numeric, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { attachments } from './attachments'
import { tenants, tenantUsers } from './core'
import { equipmentItems, equipmentTypes } from './equipment'
import { orgUnits } from './org'

// One rate row per (tenant, type). Hourly + daily + weekly + monthly stored
// on the same row so a single edit form covers the whole cadence ladder.
export const equipmentRates = pgTable(
  'equipment_rates',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    typeId: uuid('type_id')
      .notNull()
      .references(() => equipmentTypes.id, { onDelete: 'cascade' }),
    // Free-form category name for grouping the rate matrix (e.g. "Tools",
    // "Vehicles", "Lifts"). Optional — falls back to the type's category.
    category: text('category'),
    hourly: numeric('hourly', { precision: 12, scale: 2 }),
    daily: numeric('daily', { precision: 12, scale: 2 }),
    weekly: numeric('weekly', { precision: 12, scale: 2 }),
    monthly: numeric('monthly', { precision: 12, scale: 2 }),
    currency: text('currency').default('CAD').notNull(),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    tenantTypeUx: uniqueIndex('equipment_rates_tenant_type_ux').on(t.tenantId, t.typeId),
    tenantIdx: index('equipment_rates_tenant_idx').on(t.tenantId),
  }),
)

// Free-form expense ledger pinned to a specific equipment item. `category`
// is a string label ("fuel" / "repair" / "insurance" / "registration" / …)
// — kept open-ended so admins can invent new buckets without a migration.
export const equipmentExpenses = pgTable(
  'equipment_expenses',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    equipmentItemId: uuid('equipment_item_id')
      .notNull()
      .references(() => equipmentItems.id, { onDelete: 'cascade' }),
    incurredOn: date('incurred_on').notNull(),
    category: text('category').notNull(), // 'fuel' | 'repair' | 'insurance' | 'registration' | 'other'
    vendor: text('vendor'),
    description: text('description'),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').default('CAD').notNull(),
    // Optional job/project link so an expense can be re-charged through the
    // charges report.
    chargedToOrgUnitId: uuid('charged_to_org_unit_id').references(() => orgUnits.id),
    attachmentId: uuid('attachment_id').references(() => attachments.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdByTenantUserId: uuid('created_by_tenant_user_id').references(() => tenantUsers.id),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('equipment_expenses_tenant_idx').on(t.tenantId),
    itemIdx: index('equipment_expenses_item_idx').on(t.equipmentItemId, t.incurredOn),
    catIdx: index('equipment_expenses_cat_idx').on(t.tenantId, t.category),
    dateIdx: index('equipment_expenses_date_idx').on(t.tenantId, t.incurredOn),
  }),
)

export const equipmentRatesRelations = relations(equipmentRates, ({ one }) => ({
  tenant: one(tenants, { fields: [equipmentRates.tenantId], references: [tenants.id] }),
  type: one(equipmentTypes, {
    fields: [equipmentRates.typeId],
    references: [equipmentTypes.id],
  }),
}))

export const equipmentExpensesRelations = relations(equipmentExpenses, ({ one }) => ({
  tenant: one(tenants, { fields: [equipmentExpenses.tenantId], references: [tenants.id] }),
  item: one(equipmentItems, {
    fields: [equipmentExpenses.equipmentItemId],
    references: [equipmentItems.id],
  }),
  chargedTo: one(orgUnits, {
    fields: [equipmentExpenses.chargedToOrgUnitId],
    references: [orgUnits.id],
  }),
  attachment: one(attachments, {
    fields: [equipmentExpenses.attachmentId],
    references: [attachments.id],
  }),
}))
