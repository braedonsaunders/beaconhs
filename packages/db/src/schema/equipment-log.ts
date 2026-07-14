// Equipment log — freeform notes log per equipment item. Distinct from the
// audit log (which is structural, before/after JSON) and from the work-order
// table (which is repair-centric). Think of it as a per-asset shop journal:
// "swapped chuck", "noticed vibration on incline", "topped up coolant", etc.

import { relations } from 'drizzle-orm'
import { date, foreignKey, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
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
    equipmentItemId: uuid('equipment_item_id').notNull(),
    entryDate: date('entry_date').notNull(),
    // 'note' is the default catch-all. 'fuel' / 'maintenance' / 'incident' /
    // 'modification' lets the list page colour-code entries without forcing
    // structure.
    kind: text('kind').default('note').notNull(),
    title: text('title'),
    details: text('details').notNull(),
    // Optional pointers — useful for a tech filling in "on site X with crew Y".
    siteOrgUnitId: uuid('site_org_unit_id'),
    personPersonId: uuid('person_person_id'),
    attachmentId: uuid('attachment_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdByTenantUserId: uuid('created_by_tenant_user_id'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('equipment_log_entries_tenant_idx').on(t.tenantId),
    itemIdx: index('equipment_log_entries_item_idx').on(t.tenantId, t.equipmentItemId, t.entryDate),
    kindIdx: index('equipment_log_entries_kind_idx').on(t.tenantId, t.kind),
    siteIdx: index('equipment_log_entries_site_idx').on(t.tenantId, t.siteOrgUnitId),
    personIdx: index('equipment_log_entries_person_idx').on(t.tenantId, t.personPersonId),
    createdByIdx: index('equipment_log_entries_created_by_idx').on(
      t.tenantId,
      t.createdByTenantUserId,
    ),
    itemFk: foreignKey({
      name: 'equipment_log_entries_tenant_item_fk',
      columns: [t.tenantId, t.equipmentItemId],
      foreignColumns: [equipmentItems.tenantId, equipmentItems.id],
    }).onDelete('cascade'),
    siteFk: foreignKey({
      name: 'equipment_log_entries_tenant_site_fk',
      columns: [t.tenantId, t.siteOrgUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id],
    }),
    personFk: foreignKey({
      name: 'equipment_log_entries_tenant_person_fk',
      columns: [t.tenantId, t.personPersonId],
      foreignColumns: [people.tenantId, people.id],
    }),
    createdByFk: foreignKey({
      name: 'equipment_log_entries_tenant_created_by_fk',
      columns: [t.tenantId, t.createdByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
  }),
)

export const equipmentLogEntriesRelations = relations(equipmentLogEntries, ({ one }) => ({
  tenant: one(tenants, { fields: [equipmentLogEntries.tenantId], references: [tenants.id] }),
  item: one(equipmentItems, {
    fields: [equipmentLogEntries.tenantId, equipmentLogEntries.equipmentItemId],
    references: [equipmentItems.tenantId, equipmentItems.id],
  }),
  site: one(orgUnits, {
    fields: [equipmentLogEntries.tenantId, equipmentLogEntries.siteOrgUnitId],
    references: [orgUnits.tenantId, orgUnits.id],
  }),
  person: one(people, {
    fields: [equipmentLogEntries.tenantId, equipmentLogEntries.personPersonId],
    references: [people.tenantId, people.id],
  }),
  attachment: one(attachments, {
    fields: [equipmentLogEntries.attachmentId],
    references: [attachments.id],
  }),
}))
