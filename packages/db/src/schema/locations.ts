// Customer / site contacts — non-employee people associated with an org_unit
// (e.g. customer site manager, client rep, on-site emergency contact).
//
// The "customer" / "site" / "project" concept itself lives in `org_units` —
// this table only adds the people-at-that-location dimension that doesn't
// belong in `people` (which is for employees / workers tracked by HRIS).

import { relations } from 'drizzle-orm'
import { boolean, foreignKey, index, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants } from './core'
import { orgUnits } from './org'

export const customerContacts = pgTable(
  'customer_contacts',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    orgUnitId: uuid('org_unit_id').notNull(),
    name: text('name').notNull(),
    role: text('role'), // e.g. "Site Manager", "Safety Coordinator"
    email: text('email'),
    phone: text('phone'),
    notes: text('notes'),
    isPrimary: boolean('is_primary').default(false).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantOrgIdx: index('customer_contacts_tenant_org_idx').on(t.tenantId, t.orgUnitId),
    orgUnitFk: foreignKey({
      name: 'customer_contacts_tenant_org_unit_fk',
      columns: [t.tenantId, t.orgUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id],
    }).onDelete('cascade'),
  }),
)

export const customerContactsRelations = relations(customerContacts, ({ one }) => ({
  tenant: one(tenants, { fields: [customerContacts.tenantId], references: [tenants.id] }),
  orgUnit: one(orgUnits, {
    fields: [customerContacts.tenantId, customerContacts.orgUnitId],
    references: [orgUnits.tenantId, orgUnits.id],
  }),
}))
