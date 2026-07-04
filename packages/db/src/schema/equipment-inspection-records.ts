// Equipment inspection records — a concrete inspection performed against an
// equipment_item using an equipment_inspection_type. Maps to the legacy
// `EQUIPMENTINSPECTIONS` table (26.5k rows) + `EQUIPMENTINSPECTIONSCRITERIA`
// (340k per-criterion answers).
//
// Mirrors inspection_records / inspection_record_criteria but is pinned to an
// equipment_item (not a site) and snapshots the interval + next-due date so the
// upcoming-inspections report and compliance engine can read it directly.
//
// The per-criterion answers live in equipment_inspection_record_criteria,
// materialised from the type's groups + criteria at record creation time.

import { relations } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants, tenantUsers } from './core'
import { orgUnits, people } from './org'
import { equipmentItems, equipmentWorkOrders } from './equipment'
import {
  equipmentInspectionCriterionKind,
  equipmentInspectionCriterionSeverity,
  equipmentInspectionTypes,
} from './equipment-inspection-types'

export const equipmentInspectionRecordStatus = pgEnum('equipment_inspection_record_status', [
  'draft',
  'in_progress',
  'submitted',
  'closed',
])

// Overall outcome of the inspection, derived from the criterion answers at
// submit time (any fail → fail) but stored so reports don't have to re-derive.
export const equipmentInspectionResult = pgEnum('equipment_inspection_result', [
  'pass',
  'fail',
  'incomplete',
])

export const equipmentInspectionRecords = pgTable(
  'equipment_inspection_records',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    reference: text('reference').notNull(), // e.g. EQI-2026-0001

    // The template this record was materialised from. Nullable because some
    // legacy rows reference a since-deleted bank; the criteria are snapshot so
    // the record still renders.
    inspectionTypeId: uuid('inspection_type_id').references(() => equipmentInspectionTypes.id, {
      onDelete: 'set null',
    }),
    // What was inspected.
    equipmentItemId: uuid('equipment_item_id')
      .notNull()
      .references(() => equipmentItems.id, { onDelete: 'cascade' }),

    status: equipmentInspectionRecordStatus('status').default('draft').notNull(),
    result: equipmentInspectionResult('result'),
    locked: boolean('locked').default(false).notNull(),

    // When the inspection actually happened (legacy InspectionDate).
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    // Display snapshot of the cadence this record was performed under (e.g.
    // "Every 3 months", "Pre-use", "On demand") + computed next-due so the
    // upcoming report can read this row without joining the live type.
    intervalLabel: text('interval_label'),
    lastInspectionOn: date('last_inspection_on'), // legacy LastInspection
    nextDueOn: date('next_due_on'), // legacy NextInspection

    // Where it happened (legacy Location).
    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id),

    // Who performed it. tenantUser when we can resolve the app user; person for
    // the directory record; text as a freeform fallback (legacy InspectedBy).
    inspectorTenantUserId: uuid('inspector_tenant_user_id').references(() => tenantUsers.id),
    inspectorPersonId: uuid('inspector_person_id').references(() => people.id, {
      onDelete: 'set null',
    }),
    inspectorText: text('inspector_text'),
    supervisorTenantUserId: uuid('supervisor_tenant_user_id').references(() => tenantUsers.id),
    foremanPersonIds: jsonb('foreman_person_ids').$type<string[]>().default([]).notNull(),
    foremanText: text('foreman_text'),

    // Legacy operational fields carried verbatim.
    hours: numeric('hours'), // meter / hour reading at inspection
    serial: text('serial'),
    certificate: text('certificate'),
    isRental: boolean('is_rental').default(false).notNull(),
    // The work order spawned when this inspection failed (legacy WorkOrderID).
    workOrderId: uuid('work_order_id').references(() => equipmentWorkOrders.id, {
      onDelete: 'set null',
    }),

    notes: text('notes'),

    // Workflow milestones.
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    submittedByTenantUserId: uuid('submitted_by_tenant_user_id').references(() => tenantUsers.id),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedByTenantUserId: uuid('closed_by_tenant_user_id').references(() => tenantUsers.id),

    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),

    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('equipment_inspection_records_tenant_idx').on(t.tenantId),
    tenantReferenceUx: uniqueIndex('equipment_inspection_records_tenant_reference_ux').on(
      t.tenantId,
      t.reference,
    ),
    typeIdx: index('equipment_inspection_records_type_idx').on(t.tenantId, t.inspectionTypeId),
    itemIdx: index('equipment_inspection_records_item_idx').on(t.tenantId, t.equipmentItemId),
    statusIdx: index('equipment_inspection_records_status_idx').on(t.tenantId, t.status),
    occurredIdx: index('equipment_inspection_records_occurred_idx').on(t.tenantId, t.occurredAt),
    nextDueIdx: index('equipment_inspection_records_next_due_idx').on(t.tenantId, t.nextDueOn),
  }),
)

// Photos attached to the inspection record as a whole (legacy
// EQUIPMENTINSPECTIONSPHOTOS). Mirrors inspection_record_attachments so the
// photo-uploader UI can be reused as-is.
export const equipmentInspectionRecordAttachments = pgTable(
  'equipment_inspection_record_attachments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => equipmentInspectionRecords.id, { onDelete: 'cascade' }),
    attachmentId: uuid('attachment_id').notNull(),
    caption: text('caption'),
    ...timestamps,
  },
  (t) => ({
    recordIdx: index('equipment_inspection_record_attachments_record_idx').on(t.recordId),
    tenantIdx: index('equipment_inspection_record_attachments_tenant_idx').on(t.tenantId),
  }),
)

export const equipmentInspectionRecordAnswer = pgEnum('equipment_inspection_record_answer', [
  'pass',
  'fail',
  'n_a',
])

// Per-criterion responses on an equipment inspection record. One row per
// (record × criterion), materialised when the record is created. Snapshot-
// driven so editing/deleting the source criterion never rewrites history.
export const equipmentInspectionRecordCriteria = pgTable(
  'equipment_inspection_record_criteria',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => equipmentInspectionRecords.id, { onDelete: 'cascade' }),
    // Provenance pointer to the equipment_inspection_criteria row. No FK — the
    // row is fully snapshot-driven below.
    criterionId: uuid('criterion_id'),
    questionTextSnapshot: text('question_text_snapshot').notNull(),
    groupLabelSnapshot: text('group_label_snapshot'),
    kind: equipmentInspectionCriterionKind('kind').default('pass_fail').notNull(),
    requiresPhoto: boolean('requires_photo').default(false).notNull(),
    requiresComment: boolean('requires_comment').default(false).notNull(),
    isCritical: boolean('is_critical').default(false).notNull(),
    sequence: integer('sequence').notNull(),

    // Inspector's response — null until answered. `answer` covers the
    // pass/fail/N-A kinds; numericValue / textValue carry the numeric + text
    // kinds; photos go in photoAttachmentIds.
    answer: equipmentInspectionRecordAnswer('answer'),
    numericValue: numeric('numeric_value'),
    textValue: text('text_value'),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    answeredByTenantUserId: uuid('answered_by_tenant_user_id').references(() => tenantUsers.id),

    // Only populated when answer = 'fail'.
    severity: equipmentInspectionCriterionSeverity('severity'),
    comment: text('comment'),
    actionTaken: text('action_taken'),
    correctedOn: date('corrected_on'),

    // Per-criterion photos (jsonb array of attachment UUIDs).
    photoAttachmentIds: jsonb('photo_attachment_ids').$type<string[]>().default([]).notNull(),

    // The work order spawned for this specific failing criterion.
    workOrderId: uuid('work_order_id').references(() => equipmentWorkOrders.id, {
      onDelete: 'set null',
    }),

    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('equipment_inspection_record_criteria_tenant_idx').on(t.tenantId),
    recordIdx: index('equipment_inspection_record_criteria_record_idx').on(t.recordId, t.sequence),
    answerIdx: index('equipment_inspection_record_criteria_answer_idx').on(t.tenantId, t.answer),
    recordCriterionUx: uniqueIndex('equipment_inspection_record_criteria_record_criterion_ux').on(
      t.recordId,
      t.criterionId,
    ),
  }),
)

export const equipmentInspectionRecordsRelations = relations(
  equipmentInspectionRecords,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [equipmentInspectionRecords.tenantId],
      references: [tenants.id],
    }),
    type: one(equipmentInspectionTypes, {
      fields: [equipmentInspectionRecords.inspectionTypeId],
      references: [equipmentInspectionTypes.id],
    }),
    item: one(equipmentItems, {
      fields: [equipmentInspectionRecords.equipmentItemId],
      references: [equipmentItems.id],
    }),
    site: one(orgUnits, {
      fields: [equipmentInspectionRecords.siteOrgUnitId],
      references: [orgUnits.id],
    }),
    inspector: one(tenantUsers, {
      fields: [equipmentInspectionRecords.inspectorTenantUserId],
      references: [tenantUsers.id],
    }),
    workOrder: one(equipmentWorkOrders, {
      fields: [equipmentInspectionRecords.workOrderId],
      references: [equipmentWorkOrders.id],
    }),
    criteria: many(equipmentInspectionRecordCriteria),
    attachments: many(equipmentInspectionRecordAttachments),
  }),
)

export const equipmentInspectionRecordAttachmentsRelations = relations(
  equipmentInspectionRecordAttachments,
  ({ one }) => ({
    record: one(equipmentInspectionRecords, {
      fields: [equipmentInspectionRecordAttachments.recordId],
      references: [equipmentInspectionRecords.id],
    }),
  }),
)

export const equipmentInspectionRecordCriteriaRelations = relations(
  equipmentInspectionRecordCriteria,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [equipmentInspectionRecordCriteria.tenantId],
      references: [tenants.id],
    }),
    record: one(equipmentInspectionRecords, {
      fields: [equipmentInspectionRecordCriteria.recordId],
      references: [equipmentInspectionRecords.id],
    }),
  }),
)
