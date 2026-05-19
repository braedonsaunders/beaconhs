// Inspection Types — admin-defined templates that describe a class of
// inspection (e.g. "Site Walk", "Equipment Daily", "Crew Toolbox"). A type
// references N inspection_banks (criteria question banks) and toggles workflow
// requirements like foreman / customer-signature.
//
// When a user creates a new inspection_record from a type, every criterion in
// every linked bank is materialised into inspection_record_criteria rows so the
// inspector can answer pass / fail / N-A on each.
//
// Legacy parity:
//   - app/Models/InspectionType.php
//     · Name, Description, AvailableTo, SendToAdditional,
//       EnableCorrectiveActions, CompliantNotes, CustomerSignature
//   - app/Models/InspectionTypeRecord.php (criteria) — replaced by the
//     inspection_bank_criteria join via inspection_type_banks.

import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants, users } from './core'
import { inspectionBanks } from './inspection-bank'

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

// Join table: which inspection_banks (question banks) are included in this
// type. When you materialise a new record from this type, every criterion in
// every bank flows into inspection_record_criteria.
export const inspectionTypeBanks = pgTable(
  'inspection_type_banks',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    typeId: uuid('type_id')
      .notNull()
      .references(() => inspectionTypes.id, { onDelete: 'cascade' }),
    bankId: uuid('bank_id')
      .notNull()
      .references(() => inspectionBanks.id, { onDelete: 'cascade' }),
    // Order banks within the type so the inspector sees them grouped sensibly.
    sequence: integer('sequence').default(0).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('inspection_type_banks_tenant_idx').on(t.tenantId),
    typeIdx: index('inspection_type_banks_type_idx').on(t.typeId, t.sequence),
    typeBankUx: uniqueIndex('inspection_type_banks_type_bank_ux').on(t.typeId, t.bankId),
  }),
)

export const inspectionTypesRelations = relations(inspectionTypes, ({ one, many }) => ({
  tenant: one(tenants, { fields: [inspectionTypes.tenantId], references: [tenants.id] }),
  creator: one(users, { fields: [inspectionTypes.createdBy], references: [users.id] }),
  banks: many(inspectionTypeBanks),
}))

export const inspectionTypeBanksRelations = relations(inspectionTypeBanks, ({ one }) => ({
  tenant: one(tenants, { fields: [inspectionTypeBanks.tenantId], references: [tenants.id] }),
  type: one(inspectionTypes, {
    fields: [inspectionTypeBanks.typeId],
    references: [inspectionTypes.id],
  }),
  bank: one(inspectionBanks, {
    fields: [inspectionTypeBanks.bankId],
    references: [inspectionBanks.id],
  }),
}))
