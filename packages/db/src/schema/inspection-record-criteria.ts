// Per-criterion responses on an inspection_record.
//
// One row per (record × bank-criterion) pair, materialised when the record is
// created. Each row tracks either the inspector's outcome answer or one value
// from an immutable configured-choice snapshot. Outcome failures also carry
// severity, remediation, photos, assignment, due date, and an optional link
// to the auto-spawned corrective_action when severity >= high.
//
// Legacy parity: app/Models/InspectionCriteria.php fields:
//   QuestionOrder, Question, Answer (Yes/No/N/A), Severity, NonComplianceReason,
//   AlreadyCorrected, ActionTaken, AssignedToID, CompliantNotes, CorrectiveID

import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
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
import { id, timestamps } from './_helpers'
import { tenants, tenantUsers } from './core'
import { people } from './org'
import { correctiveActions } from './corrective-actions'
import { inspectionBankResponseType } from './inspection-bank'
import { inspectionRecords } from './inspection-records'

export const inspectionCriterionAnswer = pgEnum('inspection_criterion_answer', [
  'pass',
  'fail',
  'n_a',
])

export const inspectionCriterionSeverity = pgEnum('inspection_criterion_severity', [
  'low',
  'medium',
  'high',
  'critical',
])

export const inspectionRecordCriteria = pgTable(
  'inspection_record_criteria',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    recordId: uuid('record_id').notNull(),
    // Provenance pointer to the inspection_type_criteria row this was
    // materialised from. No FK — the row is fully snapshot-driven (text +
    // group + response config below), so editing or deleting the source
    // criterion never rewrites historical answers.
    criterionId: uuid('criterion_id'),
    questionTextSnapshot: text('question_text_snapshot').notNull(),
    // Snapshot of the source criterion's group + response config at
    // materialisation time, so the fill view renders section headers and the
    // correct response controls without joining back to the live type.
    groupLabelSnapshot: text('group_label_snapshot'),
    responseType: inspectionBankResponseType('response_type').default('pass_fail_na').notNull(),
    // Choice options are copied from the type at record creation. Historical
    // records never depend on the live criterion after this snapshot exists.
    choiceOptionsSnapshot: jsonb('choice_options_snapshot').$type<string[]>().default([]).notNull(),
    requiresPhoto: boolean('requires_photo').default(false).notNull(),
    requiresComment: boolean('requires_comment').default(false).notNull(),
    sequence: integer('sequence').notNull(),

    // Outcome responses use the pass/fail/N-A enum. Configured choices, text,
    // and numbers have separate columns so readers cannot conflate narrative
    // inspection data with a compliance outcome.
    answer: inspectionCriterionAnswer('answer'),
    // Only `choice` criteria use this column. The DB constraint below keeps
    // the selected label pinned to one of the immutable snapshotted options.
    choiceAnswer: text('choice_answer'),
    textAnswer: text('text_answer'),
    numberAnswer: numeric('number_answer'),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    answeredByTenantUserId: uuid('answered_by_tenant_user_id'),

    // Only populated when answer = 'fail'
    severity: inspectionCriterionSeverity('severity'),
    nonComplianceDescription: text('non_compliance_description'),
    actionTaken: text('action_taken'),
    compliantNote: text('compliant_note'),

    // Who's on the hook to fix it, and when
    assignedToPersonId: uuid('assigned_to_person_id'),
    assignedToTenantUserId: uuid('assigned_to_tenant_user_id'),
    assignedDueDate: date('assigned_due_date'),
    // When the non-compliance was actually fixed (so the UI can flag overdue items
    // when the inspection date is in the past and this is still null).
    correctedOn: date('corrected_on'),

    // Attachment ids — kept as a jsonb array of UUIDs so we don't need a
    // separate join table just for per-criterion photos. The attachments
    // themselves are stored in the global `attachments` table.
    photoAttachmentIds: jsonb('photo_attachment_ids').$type<string[]>().default([]).notNull(),

    // Auto-spawned corrective action (when severity = high|critical on a fail)
    correctiveActionId: uuid('corrective_action_id'),

    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('inspection_record_criteria_tenant_idx').on(t.tenantId),
    recordIdx: index('inspection_record_criteria_record_idx').on(
      t.tenantId,
      t.recordId,
      t.sequence,
    ),
    answerIdx: index('inspection_record_criteria_answer_idx').on(t.tenantId, t.answer),
    answeredByIdx: index('inspection_record_criteria_answered_by_idx').on(
      t.tenantId,
      t.answeredByTenantUserId,
    ),
    assignedPersonIdx: index('inspection_record_criteria_assigned_person_idx').on(
      t.tenantId,
      t.assignedToPersonId,
    ),
    assignedUserIdx: index('inspection_record_criteria_assigned_user_idx').on(
      t.tenantId,
      t.assignedToTenantUserId,
    ),
    correctiveIdx: index('inspection_record_criteria_corrective_idx').on(
      t.tenantId,
      t.correctiveActionId,
    ),
    recordCriterionUx: uniqueIndex('inspection_record_criteria_record_criterion_ux').on(
      t.tenantId,
      t.recordId,
      t.criterionId,
    ),
    recordFk: foreignKey({
      name: 'inspection_record_criteria_tenant_record_fk',
      columns: [t.tenantId, t.recordId],
      foreignColumns: [inspectionRecords.tenantId, inspectionRecords.id],
    }).onDelete('cascade'),
    answeredByFk: foreignKey({
      name: 'inspection_record_criteria_tenant_answered_by_fk',
      columns: [t.tenantId, t.answeredByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    assignedPersonFk: foreignKey({
      name: 'inspection_record_criteria_tenant_assigned_person_fk',
      columns: [t.tenantId, t.assignedToPersonId],
      foreignColumns: [people.tenantId, people.id],
    }),
    assignedUserFk: foreignKey({
      name: 'inspection_record_criteria_tenant_assigned_user_fk',
      columns: [t.tenantId, t.assignedToTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    correctiveActionFk: foreignKey({
      name: 'inspection_record_criteria_tenant_corrective_action_fk',
      columns: [t.tenantId, t.correctiveActionId],
      foreignColumns: [correctiveActions.tenantId, correctiveActions.id],
    }),
    responseShapeCk: check(
      'inspection_record_criteria_response_shape_ck',
      sql`(
        ${t.responseType} = 'choice'
        AND ${t.answer} IS NULL
        AND jsonb_typeof(${t.choiceOptionsSnapshot}) = 'array'
        AND jsonb_array_length(${t.choiceOptionsSnapshot}) BETWEEN 2 AND 50
        AND (${t.choiceAnswer} IS NULL OR ${t.choiceOptionsSnapshot} ? ${t.choiceAnswer})
        AND ${t.textAnswer} IS NULL
        AND ${t.numberAnswer} IS NULL
      ) OR (
        ${t.responseType} IN ('text', 'long_text')
        AND ${t.answer} IS NULL
        AND ${t.choiceOptionsSnapshot} = '[]'::jsonb
        AND ${t.choiceAnswer} IS NULL
        AND ${t.numberAnswer} IS NULL
      ) OR (
        ${t.responseType} = 'number'
        AND ${t.answer} IS NULL
        AND ${t.choiceOptionsSnapshot} = '[]'::jsonb
        AND ${t.choiceAnswer} IS NULL
        AND ${t.textAnswer} IS NULL
      ) OR (
        ${t.responseType} IN ('pass_fail_na', 'rating', 'yes_no')
        AND ${t.choiceOptionsSnapshot} = '[]'::jsonb
        AND ${t.choiceAnswer} IS NULL
        AND ${t.textAnswer} IS NULL
        AND ${t.numberAnswer} IS NULL
      )`,
    ),
  }),
)

export const inspectionRecordCriteriaRelations = relations(inspectionRecordCriteria, ({ one }) => ({
  tenant: one(tenants, {
    fields: [inspectionRecordCriteria.tenantId],
    references: [tenants.id],
  }),
  record: one(inspectionRecords, {
    fields: [inspectionRecordCriteria.tenantId, inspectionRecordCriteria.recordId],
    references: [inspectionRecords.tenantId, inspectionRecords.id],
  }),
  correctiveAction: one(correctiveActions, {
    fields: [inspectionRecordCriteria.tenantId, inspectionRecordCriteria.correctiveActionId],
    references: [correctiveActions.tenantId, correctiveActions.id],
  }),
  assignedToPerson: one(people, {
    fields: [inspectionRecordCriteria.tenantId, inspectionRecordCriteria.assignedToPersonId],
    references: [people.tenantId, people.id],
  }),
  assignedToTenantUser: one(tenantUsers, {
    fields: [inspectionRecordCriteria.tenantId, inspectionRecordCriteria.assignedToTenantUserId],
    references: [tenantUsers.tenantId, tenantUsers.id],
  }),
}))
