// PPE criteria banks — reusable, severity-aware pools of inspection criteria.
//
// A bank groups N questions in a defined sequence; each criterion carries the
// PPE `severity` (drives auto-corrective-actions on fail) and a `requiresPhoto`
// flag. A PPE type imports a bank in as a new section, snapshotting each
// question's config so later edits to the bank don't rewrite the type.
//
// This mirrors the inspection-bank tables but preserves PPE's severity field,
// which the generic inspection banks don't carry.

import { relations } from 'drizzle-orm'
import { boolean, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants, users } from './core'
import { ppeCriterionSeverity } from './ppe-types-criteria'

export const ppeCriteriaBanks = pgTable(
  'ppe_criteria_banks',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category'), // 'head' | 'eye' | 'fall' | 'respiratory' | …
    isPublished: boolean('is_published').default(false).notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('ppe_criteria_banks_tenant_idx').on(t.tenantId),
    tenantCategoryIdx: index('ppe_criteria_banks_tenant_category_idx').on(t.tenantId, t.category),
  }),
)

export const ppeCriteriaBankCriteria = pgTable(
  'ppe_criteria_bank_criteria',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bankId: uuid('bank_id')
      .notNull()
      .references(() => ppeCriteriaBanks.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    question: text('question').notNull(),
    description: text('description'),
    severity: ppeCriterionSeverity('severity').default('medium').notNull(),
    requiresPhoto: boolean('requires_photo').default(false).notNull(),
    ...timestamps,
  },
  (t) => ({
    bankSeqIdx: index('ppe_criteria_bank_criteria_bank_seq_idx').on(t.bankId, t.sequence),
    tenantIdx: index('ppe_criteria_bank_criteria_tenant_idx').on(t.tenantId),
  }),
)

export const ppeCriteriaBanksRelations = relations(ppeCriteriaBanks, ({ one, many }) => ({
  tenant: one(tenants, { fields: [ppeCriteriaBanks.tenantId], references: [tenants.id] }),
  creator: one(users, { fields: [ppeCriteriaBanks.createdBy], references: [users.id] }),
  criteria: many(ppeCriteriaBankCriteria),
}))

export const ppeCriteriaBankCriteriaRelations = relations(ppeCriteriaBankCriteria, ({ one }) => ({
  tenant: one(tenants, { fields: [ppeCriteriaBankCriteria.tenantId], references: [tenants.id] }),
  bank: one(ppeCriteriaBanks, {
    fields: [ppeCriteriaBankCriteria.bankId],
    references: [ppeCriteriaBanks.id],
  }),
}))
