// Inspection Bank — reusable criteria templates that can seed an inspection
// form. A bank groups N criteria (questions) in a defined sequence; each
// criterion specifies a response type (pass/fail/N-A, yes/no, historical
// rating fallback, configured choice, text, long text, or number) and
// whether photo / comment is required.

import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants, users } from './core'

export const inspectionBanks = pgTable(
  'inspection_banks',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category'), // 'site_inspection' | 'ppe_check' | 'equipment_check' | …
    isPublished: boolean('is_published').default(false).notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('inspection_banks_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('inspection_banks_tenant_id_id_ux').on(t.tenantId, t.id),
    tenantCategoryIdx: index('inspection_banks_tenant_category_idx').on(t.tenantId, t.category),
  }),
)

export const inspectionBankResponseType = pgEnum('inspection_bank_response_type', [
  'pass_fail_na',
  'rating',
  'yes_no',
  'choice',
  'text',
  'long_text',
  'number',
])

export const inspectionBankCriteria = pgTable(
  'inspection_bank_criteria',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bankId: uuid('bank_id').notNull(),
    sequence: integer('sequence').notNull(),
    text: text('text').notNull(),
    requiresPhoto: boolean('requires_photo').default(false).notNull(),
    requiresComment: boolean('requires_comment').default(false).notNull(),
    responseType: inspectionBankResponseType('response_type').notNull(),
    choiceOptions: jsonb('choice_options').$type<string[]>().default([]).notNull(),
    ...timestamps,
  },
  (t) => ({
    bankSeqIdx: index('inspection_bank_criteria_bank_seq_idx').on(t.tenantId, t.bankId, t.sequence),
    tenantIdx: index('inspection_bank_criteria_tenant_idx').on(t.tenantId),
    bankFk: foreignKey({
      name: 'inspection_bank_criteria_tenant_bank_fk',
      columns: [t.tenantId, t.bankId],
      foreignColumns: [inspectionBanks.tenantId, inspectionBanks.id],
    }).onDelete('cascade'),
    choiceOptionsCk: check(
      'inspection_bank_criteria_choice_options_ck',
      sql`(
        ${t.responseType} = 'choice'
        AND jsonb_typeof(${t.choiceOptions}) = 'array'
        AND jsonb_array_length(${t.choiceOptions}) BETWEEN 2 AND 50
      ) OR (
        ${t.responseType} <> 'choice'
        AND ${t.choiceOptions} = '[]'::jsonb
      )`,
    ),
  }),
)

export const inspectionBanksRelations = relations(inspectionBanks, ({ one, many }) => ({
  tenant: one(tenants, { fields: [inspectionBanks.tenantId], references: [tenants.id] }),
  creator: one(users, { fields: [inspectionBanks.createdBy], references: [users.id] }),
  criteria: many(inspectionBankCriteria),
}))

export const inspectionBankCriteriaRelations = relations(inspectionBankCriteria, ({ one }) => ({
  tenant: one(tenants, { fields: [inspectionBankCriteria.tenantId], references: [tenants.id] }),
  bank: one(inspectionBanks, {
    fields: [inspectionBankCriteria.tenantId, inspectionBankCriteria.bankId],
    references: [inspectionBanks.tenantId, inspectionBanks.id],
  }),
}))
