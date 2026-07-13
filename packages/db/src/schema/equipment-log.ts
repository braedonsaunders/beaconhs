// Equipment log — freeform notes log per equipment item. Distinct from the
// audit log (which is structural, before/after JSON) and from the work-order
// table (which is repair-centric). Think of it as a per-asset shop journal:
// "swapped chuck", "noticed vibration on incline", "topped up coolant", etc.

import { relations } from 'drizzle-orm'
import { date, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { attachments } from './attachments'
import { tenants, tenantUsers } from './core'
import { equipmentItems } from './equipment'
import { orgUnits, people } from './org'

export const equipmentLogEntries = pgTable(
  'equipment_log_entries',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    equipmentItemId: uuid('equipment_item_id')
      .notNull()
      .references(() => equipmentItems.id, { onDelete: 'cascade' }),
    entryDate: date('entry_date').notNull(),
    // 'note' is the default catch-all. 'fuel' / 'maintenance' / 'incident' /
    // 'modification' lets the list page colour-code entries without forcing
    // structure.
    kind: text('kind').default('note').notNull(),
    title: text('title'),
    details: text('details').notNull(),
    // Optional pointers — useful for a tech filling in "on site X with crew Y".
    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id),
    personPersonId: uuid('person_person_id').references(() => people.id),
    attachmentId: uuid('attachment_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdByTenantUserId: uuid('created_by_tenant_user_id').references(() => tenantUsers.id),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('equipment_log_entries_tenant_idx').on(t.tenantId),
    itemIdx: index('equipment_log_entries_item_idx').on(t.equipmentItemId, t.entryDate),
    kindIdx: index('equipment_log_entries_kind_idx').on(t.tenantId, t.kind),
  }),
)

export const equipmentLogEntriesRelations = relations(equipmentLogEntries, ({ one }) => ({
  tenant: one(tenants, { fields: [equipmentLogEntries.tenantId], references: [tenants.id] }),
  item: one(equipmentItems, {
    fields: [equipmentLogEntries.equipmentItemId],
    references: [equipmentItems.id],
  }),
  site: one(orgUnits, {
    fields: [equipmentLogEntries.siteOrgUnitId],
    references: [orgUnits.id],
  }),
  person: one(people, {
    fields: [equipmentLogEntries.personPersonId],
    references: [people.id],
  }),
  attachment: one(attachments, {
    fields: [equipmentLogEntries.attachmentId],
    references: [attachments.id],
  }),
}))
