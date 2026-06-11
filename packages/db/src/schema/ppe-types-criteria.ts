// Per-type catalog of pass/fail inspection criteria.
//
// Each `ppe_type` (e.g. "Full-body harness") owns an ordered list of yes/no
// criteria that an inspector runs through whenever they record a pre-use or
// annual inspection on an item of that type. Severity drives auto-CA escalation
// on `fail`; `requiresPhoto` forces the inspector to attach evidence.
//
// Legacy parity (app/Models/PPETypeRecord.php → table PPETYPESRECORDS):
//   PPETypeID, Criteria, Description, EntityOrder, Type ('PreUse' | 'Annual')
//
// We split the legacy Type column into a dedicated enum and add the modern
// `severity` + `requires_photo` columns so the inspection flow can mirror the
// inspections module exactly.

import { relations } from 'drizzle-orm'
import { boolean, index, integer, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants } from './core'
import { ppeTypes } from './ppe'

export const ppeCriterionInspectionKind = pgEnum('ppe_criterion_inspection_kind', [
  'pre_use',
  'annual',
])

export const ppeCriterionSeverity = pgEnum('ppe_criterion_severity', [
  'low',
  'medium',
  'high',
  'critical',
])

export const ppeTypeInspectionCriteria = pgTable(
  'ppe_type_inspection_criteria',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    ppeTypeId: uuid('ppe_type_id')
      .notNull()
      .references(() => ppeTypes.id, { onDelete: 'cascade' }),
    inspectionKind: ppeCriterionInspectionKind('inspection_kind').notNull().default('pre_use'),
    question: text('question').notNull(),
    description: text('description'),
    severity: ppeCriterionSeverity('severity').default('medium').notNull(),
    requiresPhoto: boolean('requires_photo').default(false).notNull(),
    entityOrder: integer('entity_order').default(0).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('ppe_type_inspection_criteria_tenant_idx').on(t.tenantId),
    typeIdx: index('ppe_type_inspection_criteria_type_idx').on(
      t.ppeTypeId,
      t.inspectionKind,
      t.entityOrder,
    ),
  }),
)

export const ppeTypeInspectionCriteriaRelations = relations(
  ppeTypeInspectionCriteria,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [ppeTypeInspectionCriteria.tenantId],
      references: [tenants.id],
    }),
    ppeType: one(ppeTypes, {
      fields: [ppeTypeInspectionCriteria.ppeTypeId],
      references: [ppeTypes.id],
    }),
  }),
)
