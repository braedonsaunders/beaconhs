// Inspection type content — the criteria a type checks, owned directly by the
// type and organised into ordered groups.
//
// This replaces the old model where a type linked reusable "banks" and the
// criteria lived only on banks. Now a type owns its groups + criteria directly
// (you can author questions without any bank at all). Banks
// (inspection_banks / inspection_bank_criteria) remain as a reusable LIBRARY
// you import criteria FROM into a type group — see the importBankIntoType
// server action.
//
// When a record is created from a type, every criterion (in group order, then
// ungrouped) is materialised into inspection_record_criteria with the group
// label snapshotted so the fill view can render section headers.

import { relations } from 'drizzle-orm'
import { boolean, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants } from './core'
import { inspectionBankResponseType } from './inspection-bank'
import { inspectionTypes } from './inspection-types'

// A named section of criteria within a type. Ordered by `sequence`.
export const inspectionTypeGroups = pgTable(
  'inspection_type_groups',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    typeId: uuid('type_id')
      .notNull()
      .references(() => inspectionTypes.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').default(0).notNull(),
    label: text('label').notNull(),
    description: text('description'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('inspection_type_groups_tenant_idx').on(t.tenantId),
    typeSeqIdx: index('inspection_type_groups_type_seq_idx').on(t.typeId, t.sequence),
  }),
)

// A single criterion (question) owned by a type, optionally inside a group.
// groupId null = ungrouped (rendered in a default section).
export const inspectionTypeCriteria = pgTable(
  'inspection_type_criteria',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    typeId: uuid('type_id')
      .notNull()
      .references(() => inspectionTypes.id, { onDelete: 'cascade' }),
    // Null = ungrouped. Groups can be deleted without losing the criterion.
    groupId: uuid('group_id').references(() => inspectionTypeGroups.id, {
      onDelete: 'set null',
    }),
    sequence: integer('sequence').default(0).notNull(),
    text: text('text').notNull(),
    responseType: inspectionBankResponseType('response_type').default('pass_fail_na').notNull(),
    requiresPhoto: boolean('requires_photo').default(false).notNull(),
    requiresComment: boolean('requires_comment').default(false).notNull(),
    // Provenance when copied in from a bank. No FK — banks can be edited or
    // deleted independently; this is a soft "imported from" pointer only.
    sourceBankId: uuid('source_bank_id'),
    sourceBankCriterionId: uuid('source_bank_criterion_id'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('inspection_type_criteria_tenant_idx').on(t.tenantId),
    typeGroupSeqIdx: index('inspection_type_criteria_type_group_seq_idx').on(
      t.typeId,
      t.groupId,
      t.sequence,
    ),
  }),
)

export const inspectionTypeGroupsRelations = relations(inspectionTypeGroups, ({ one, many }) => ({
  tenant: one(tenants, { fields: [inspectionTypeGroups.tenantId], references: [tenants.id] }),
  type: one(inspectionTypes, {
    fields: [inspectionTypeGroups.typeId],
    references: [inspectionTypes.id],
  }),
  criteria: many(inspectionTypeCriteria),
}))

export const inspectionTypeCriteriaRelations = relations(inspectionTypeCriteria, ({ one }) => ({
  tenant: one(tenants, { fields: [inspectionTypeCriteria.tenantId], references: [tenants.id] }),
  type: one(inspectionTypes, {
    fields: [inspectionTypeCriteria.typeId],
    references: [inspectionTypes.id],
  }),
  group: one(inspectionTypeGroups, {
    fields: [inspectionTypeCriteria.groupId],
    references: [inspectionTypeGroups.id],
  }),
}))
