// Per-criterion responses on an inspection_record.
//
// One row per (record × bank-criterion) pair, materialised when the record is
// created. Each row tracks the inspector's pass/fail/N-A answer plus the
// failure metadata (severity, non-compliance description, action taken, photo
// IDs, who it's assigned to, due date) plus an optional link back to the
// auto-spawned corrective_action when severity >= high.
//
// Legacy parity: app/Models/InspectionCriteria.php fields:
//   QuestionOrder, Question, Answer (Yes/No/N/A), Severity, NonComplianceReason,
//   AlreadyCorrected, ActionTaken, AssignedToID, CompliantNotes, CorrectiveID

import { relations } from 'drizzle-orm'
import {
  date,
  index,
  integer,
  jsonb,
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
import { inspectionBankCriteria } from './inspection-bank'
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
    recordId: uuid('record_id')
      .notNull()
      .references(() => inspectionRecords.id, { onDelete: 'cascade' }),
    // FK to the original bank criterion — `text` and `requiresPhoto` flags can
    // be looked up there. We DON'T snapshot the text on the row so that
    // wording corrections on the bank flow through automatically; if the bank
    // is deleted we still keep the row + a snapshot of the question text.
    criterionId: uuid('criterion_id').references(() => inspectionBankCriteria.id, {
      onDelete: 'set null',
    }),
    questionTextSnapshot: text('question_text_snapshot').notNull(),
    sequence: integer('sequence').notNull(),

    // Inspector's response — null until they pick one.
    answer: inspectionCriterionAnswer('answer'),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    answeredByTenantUserId: uuid('answered_by_tenant_user_id').references(() => tenantUsers.id),

    // Only populated when answer = 'fail'
    severity: inspectionCriterionSeverity('severity'),
    nonComplianceDescription: text('non_compliance_description'),
    actionTaken: text('action_taken'),
    compliantNote: text('compliant_note'),

    // Who's on the hook to fix it, and when
    assignedToPersonId: uuid('assigned_to_person_id').references(() => people.id, {
      onDelete: 'set null',
    }),
    assignedToTenantUserId: uuid('assigned_to_tenant_user_id').references(() => tenantUsers.id, {
      onDelete: 'set null',
    }),
    assignedDueDate: date('assigned_due_date'),
    // When the non-compliance was actually fixed (so the UI can flag overdue items
    // when the inspection date is in the past and this is still null).
    correctedOn: date('corrected_on'),

    // Attachment ids — kept as a jsonb array of UUIDs so we don't need a
    // separate join table just for per-criterion photos. The attachments
    // themselves are stored in the global `attachments` table.
    photoAttachmentIds: jsonb('photo_attachment_ids').$type<string[]>().default([]).notNull(),

    // Auto-spawned corrective action (when severity = high|critical on a fail)
    correctiveActionId: uuid('corrective_action_id').references(() => correctiveActions.id, {
      onDelete: 'set null',
    }),

    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('inspection_record_criteria_tenant_idx').on(t.tenantId),
    recordIdx: index('inspection_record_criteria_record_idx').on(t.recordId, t.sequence),
    answerIdx: index('inspection_record_criteria_answer_idx').on(t.tenantId, t.answer),
    correctiveIdx: index('inspection_record_criteria_corrective_idx').on(t.correctiveActionId),
    recordCriterionUx: uniqueIndex('inspection_record_criteria_record_criterion_ux').on(
      t.recordId,
      t.criterionId,
    ),
  }),
)

export const inspectionRecordCriteriaRelations = relations(inspectionRecordCriteria, ({ one }) => ({
  tenant: one(tenants, {
    fields: [inspectionRecordCriteria.tenantId],
    references: [tenants.id],
  }),
  record: one(inspectionRecords, {
    fields: [inspectionRecordCriteria.recordId],
    references: [inspectionRecords.id],
  }),
  criterion: one(inspectionBankCriteria, {
    fields: [inspectionRecordCriteria.criterionId],
    references: [inspectionBankCriteria.id],
  }),
  correctiveAction: one(correctiveActions, {
    fields: [inspectionRecordCriteria.correctiveActionId],
    references: [correctiveActions.id],
  }),
  assignedToPerson: one(people, {
    fields: [inspectionRecordCriteria.assignedToPersonId],
    references: [people.id],
  }),
  assignedToTenantUser: one(tenantUsers, {
    fields: [inspectionRecordCriteria.assignedToTenantUserId],
    references: [tenantUsers.id],
  }),
}))
