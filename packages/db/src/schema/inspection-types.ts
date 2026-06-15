// Inspection Types — admin-defined templates that describe a class of
// inspection (e.g. "Site Walk", "Equipment Daily", "Crew Toolbox"). A type owns
// its criteria directly, organised into groups (see inspection-type-content.ts),
// and toggles workflow requirements like foreman / customer-signature.
//
// When a user creates a new inspection_record from a type, every criterion (in
// group order, then ungrouped) is materialised into inspection_record_criteria
// rows so the inspector can answer pass / fail / N-A on each.
//
// Legacy parity:
//   - app/Models/InspectionType.php
//     · Name, Description, AvailableTo, SendToAdditional,
//       EnableCorrectiveActions, CompliantNotes, CustomerSignature
//   - app/Models/InspectionTypeRecord.php (criteria) — now inspection_type_criteria.

import { relations } from 'drizzle-orm'
import { boolean, index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants, users } from './core'

export const inspectionTypes = pgTable(
  'inspection_types',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),

    // Workflow requirements toggled per type
    requiresForeman: boolean('requires_foreman').default(false).notNull(),
    requiresCustomerSignature: boolean('requires_customer_signature').default(false).notNull(),
    enableCorrectiveActions: boolean('enable_corrective_actions').default(true).notNull(),
    allowCompliantNotes: boolean('allow_compliant_notes').default(true).notNull(),

    // Cadence hint — used by the assignment wizard as a default cron
    // ('day' | 'week' | 'month' | 'quarter' | 'year'). Free-form so we can
    // extend later without a migration.
    defaultCadence: text('default_cadence'),

    // List of role keys / person ids who can see this type when starting an
    // inspection. Null = everyone.
    availableTo: jsonb('available_to').$type<{
      roleKeys?: string[]
      personIds?: string[]
      orgUnitIds?: string[]
    } | null>(),

    // Additional people copied on submission notification emails.
    notifyPersonIds: jsonb('notify_person_ids').$type<string[]>().default([]).notNull(),

    isPublished: boolean('is_published').default(true).notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('inspection_types_tenant_idx').on(t.tenantId),
    tenantNameUx: uniqueIndex('inspection_types_tenant_name_ux').on(t.tenantId, t.name),
  }),
)

// NOTE: the criteria a type checks now live directly on the type, organised
// into groups — see inspection-type-content.ts (inspection_type_groups /
// inspection_type_criteria). The old inspection_type_banks join table was
// dropped; banks are now only a reusable import library.

export const inspectionTypesRelations = relations(inspectionTypes, ({ one }) => ({
  tenant: one(tenants, { fields: [inspectionTypes.tenantId], references: [tenants.id] }),
  creator: one(users, { fields: [inspectionTypes.createdBy], references: [users.id] }),
}))
