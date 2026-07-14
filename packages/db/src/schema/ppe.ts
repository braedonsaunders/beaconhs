// PPE — separate from Equipment to preserve issue / return / discard lifecycle.

import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
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
import { id, softDelete, timestamps } from './_helpers'
import { tenants, tenantUsers } from './core'
import { people } from './org'

export const ppeTypes = pgTable(
  'ppe_types',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category'), // 'head' | 'eye' | 'hand' | 'foot' | 'fall' | 'respiratory' | …
    isInspectable: boolean('is_inspectable').default(false).notNull(),
    // Inspection / recertification config blob for the type. `requiresCertificate`
    // flags that this type needs third-party recertification certificates (drives
    // the Certificates tab on the record page) — stored here rather than as a
    // dedicated column to avoid a migration on this RLS-managed table.
    inspectionSchedule: jsonb('inspection_schedule').$type<{
      cron?: string
      everyDays?: number
      templateKey?: string
      requiresCertificate?: boolean
    } | null>(),
    sizingScheme: jsonb('sizing_scheme').$type<string[] | null>(), // e.g. ['S','M','L','XL']
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('ppe_types_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('ppe_types_tenant_id_id_ux').on(t.tenantId, t.id),
  }),
)

export const ppeItemStatus = pgEnum('ppe_item_status', [
  'in_stock',
  'issued',
  'returned',
  'damaged',
  'discarded',
  'expired',
])

export const ppeItems = pgTable(
  'ppe_items',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    typeId: uuid('type_id').notNull(),
    serialNumber: text('serial_number'),
    size: text('size'),
    status: ppeItemStatus('status').default('in_stock').notNull(),
    // Draft-first (badged): instant-created items show in the register with a
    // "Draft" badge until completed — never hidden. Existing rows default false.
    isDraft: boolean('is_draft').default(false).notNull(),
    currentHolderPersonId: uuid('current_holder_person_id'),
    purchaseDate: date('purchase_date'),
    expiresOn: date('expires_on'),
    notes: text('notes'),
    lastInspectionOn: date('last_inspection_on'),
    nextInspectionDue: date('next_inspection_due'),
    lastAnnualInspectionOn: date('last_annual_inspection_on'),
    nextAnnualInspectionDue: date('next_annual_inspection_due'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('ppe_items_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('ppe_items_tenant_id_id_ux').on(t.tenantId, t.id),
    typeIdx: index('ppe_items_type_idx').on(t.tenantId, t.typeId),
    holderIdx: index('ppe_items_holder_idx').on(t.tenantId, t.currentHolderPersonId),
    tenantSerialUx: uniqueIndex('ppe_items_tenant_serial_ux').on(t.tenantId, t.serialNumber),
    // Accelerate jsonb containment over custom-field values (metadata.custom).
    metadataGin: index('ppe_items_metadata_gin').using('gin', t.metadata),
    typeFk: foreignKey({
      name: 'ppe_items_tenant_type_fk',
      columns: [t.tenantId, t.typeId],
      foreignColumns: [ppeTypes.tenantId, ppeTypes.id],
    }),
    currentHolderFk: foreignKey({
      name: 'ppe_items_tenant_current_holder_fk',
      columns: [t.tenantId, t.currentHolderPersonId],
      foreignColumns: [people.tenantId, people.id],
    }),
  }),
)

export const ppeIssueAction = pgEnum('ppe_issue_action', [
  'issue',
  'return',
  'replace',
  'mark_damaged',
  'discard',
])

export const ppeIssues = pgTable(
  'ppe_issues',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').notNull(),
    personId: uuid('person_id'),
    action: ppeIssueAction('action').notNull(),
    quantity: integer('quantity').default(1).notNull(),
    issuedByTenantUserId: uuid('issued_by_tenant_user_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    note: text('note'),
    receiptSignatureAttachmentId: uuid('receipt_signature_attachment_id'),
    ...timestamps,
  },
  (t) => ({
    itemIdx: index('ppe_issues_item_idx').on(t.tenantId, t.itemId),
    personIdx: index('ppe_issues_person_idx').on(t.tenantId, t.personId),
    issuedByIdx: index('ppe_issues_issued_by_idx').on(t.tenantId, t.issuedByTenantUserId),
    tenantIdx: index('ppe_issues_tenant_idx').on(t.tenantId),
    itemFk: foreignKey({
      name: 'ppe_issues_tenant_item_fk',
      columns: [t.tenantId, t.itemId],
      foreignColumns: [ppeItems.tenantId, ppeItems.id],
    }).onDelete('cascade'),
    personFk: foreignKey({
      name: 'ppe_issues_tenant_person_fk',
      columns: [t.tenantId, t.personId],
      foreignColumns: [people.tenantId, people.id],
    }),
    issuedByFk: foreignKey({
      name: 'ppe_issues_tenant_issued_by_fk',
      columns: [t.tenantId, t.issuedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
  }),
)

// Inspection record (per-item, per-event). Pre-use or scheduled annual.
export const ppeInspectionKind = pgEnum('ppe_inspection_kind', ['pre_use', 'annual'])
export const ppeInspectionResult = pgEnum('ppe_inspection_result', ['pass', 'fail', 'n_a'])
export const ppeInspectionStatus = pgEnum('ppe_inspection_status', ['in_progress', 'submitted'])
export const ppeCriterionSeverity = pgEnum('ppe_criterion_severity', [
  'low',
  'medium',
  'high',
  'critical',
])

export const ppeInspections = pgTable(
  'ppe_inspections',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').notNull(),
    kind: ppeInspectionKind('kind').notNull(),
    status: ppeInspectionStatus('status').default('submitted').notNull(),
    result: ppeInspectionResult('result'),
    inspectedByTenantUserId: uuid('inspected_by_tenant_user_id'),
    // Immutable display evidence for historical and imported inspections. The
    // optional actor FK remains authoritative when the account still exists,
    // while this snapshot survives account renames or an unmapped legacy user.
    inspectorNameSnapshot: text('inspector_name_snapshot'),
    inspectedOn: date('inspected_on'),
    nextDueOn: date('next_due_on'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    itemIdx: index('ppe_inspections_item_idx').on(t.tenantId, t.itemId, t.inspectedOn),
    tenantIdIdUx: uniqueIndex('ppe_inspections_tenant_id_id_ux').on(t.tenantId, t.id),
    inspectedByIdx: index('ppe_inspections_inspected_by_idx').on(
      t.tenantId,
      t.inspectedByTenantUserId,
    ),
    tenantIdx: index('ppe_inspections_tenant_idx').on(t.tenantId),
    itemFk: foreignKey({
      name: 'ppe_inspections_tenant_item_fk',
      columns: [t.tenantId, t.itemId],
      foreignColumns: [ppeItems.tenantId, ppeItems.id],
    }).onDelete('cascade'),
    inspectedByFk: foreignKey({
      name: 'ppe_inspections_tenant_inspected_by_fk',
      columns: [t.tenantId, t.inspectedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    submittedResultCk: check(
      'ppe_inspections_submitted_result_ck',
      sql`${t.status} <> 'submitted' OR (${t.result} IS NOT NULL AND ${t.inspectedOn} IS NOT NULL)`,
    ),
  }),
)

// Immutable per-criterion evidence captured with a PPE inspection. The source
// criterion is intentionally a soft pointer: checklist edits must never rewrite
// the question, severity, or evidence that was actually inspected.
export const ppeInspectionCriteria = pgTable(
  'ppe_inspection_criteria',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    inspectionId: uuid('inspection_id').notNull(),
    criterionId: uuid('criterion_id'),
    questionTextSnapshot: text('question_text_snapshot').notNull(),
    descriptionSnapshot: text('description_snapshot'),
    severity: ppeCriterionSeverity('severity').default('medium').notNull(),
    requiresPhoto: boolean('requires_photo').default(false).notNull(),
    sequence: integer('sequence').notNull(),
    answer: ppeInspectionResult('answer'),
    nonComplianceReason: text('non_compliance_reason'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('ppe_inspection_criteria_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('ppe_inspection_criteria_tenant_id_id_ux').on(t.tenantId, t.id),
    inspectionIdx: index('ppe_inspection_criteria_inspection_idx').on(
      t.tenantId,
      t.inspectionId,
      t.sequence,
    ),
    answerIdx: index('ppe_inspection_criteria_answer_idx').on(t.tenantId, t.answer),
    inspectionCriterionUx: uniqueIndex('ppe_inspection_criteria_inspection_criterion_ux').on(
      t.tenantId,
      t.inspectionId,
      t.criterionId,
    ),
    inspectionFk: foreignKey({
      name: 'ppe_inspection_criteria_tenant_inspection_fk',
      columns: [t.tenantId, t.inspectionId],
      foreignColumns: [ppeInspections.tenantId, ppeInspections.id],
    }).onDelete('cascade'),
  }),
)

// Inspection-level and per-criterion photos share one normalized attachment
// link with exactly one owner. Legacy record photos point at the inspection;
// new checklist evidence points at the exact immutable response row. Keeping
// the two owner columns mutually exclusive makes a cross-inspection criterion
// mismatch impossible at the database boundary.
export const ppeInspectionAttachments = pgTable(
  'ppe_inspection_attachments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    inspectionId: uuid('inspection_id'),
    criterionResultId: uuid('criterion_result_id'),
    attachmentId: uuid('attachment_id').notNull(),
    caption: text('caption'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('ppe_inspection_attachments_tenant_idx').on(t.tenantId),
    inspectionIdx: index('ppe_inspection_attachments_inspection_idx').on(
      t.tenantId,
      t.inspectionId,
    ),
    criterionIdx: index('ppe_inspection_attachments_criterion_idx').on(
      t.tenantId,
      t.criterionResultId,
    ),
    inspectionAttachmentUx: uniqueIndex('ppe_inspection_attachments_inspection_attachment_ux').on(
      t.tenantId,
      t.inspectionId,
      t.attachmentId,
    ),
    criterionAttachmentUx: uniqueIndex('ppe_inspection_attachments_criterion_attachment_ux').on(
      t.tenantId,
      t.criterionResultId,
      t.attachmentId,
    ),
    inspectionFk: foreignKey({
      name: 'ppe_inspection_attachments_tenant_inspection_fk',
      columns: [t.tenantId, t.inspectionId],
      foreignColumns: [ppeInspections.tenantId, ppeInspections.id],
    }).onDelete('cascade'),
    criterionFk: foreignKey({
      name: 'ppe_inspection_attachments_tenant_criterion_fk',
      columns: [t.tenantId, t.criterionResultId],
      foreignColumns: [ppeInspectionCriteria.tenantId, ppeInspectionCriteria.id],
    }).onDelete('cascade'),
    exactlyOneOwnerCk: check(
      'ppe_inspection_attachments_exactly_one_owner_ck',
      sql`(${t.inspectionId} IS NULL) <> (${t.criterionResultId} IS NULL)`,
    ),
  }),
)

// Issues / damage reports against a PPE item.
export const ppeIssueStatus = pgEnum('ppe_issue_status', ['open', 'resolved', 'replaced'])

export const ppeIssueReports = pgTable(
  'ppe_issue_reports',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').notNull(),
    inspectionId: uuid('inspection_id'),
    reportedByTenantUserId: uuid('reported_by_tenant_user_id'),
    reportedByNameSnapshot: text('reported_by_name_snapshot'),
    reportedAt: timestamp('reported_at', { withTimezone: true }).defaultNow().notNull(),
    description: text('description').notNull(),
    status: ppeIssueStatus('status').default('open').notNull(),
    resolution: text('resolution'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    source: text('source').default('manual').notNull(),
    ...timestamps,
  },
  (t) => ({
    itemIdx: index('ppe_issue_reports_item_idx').on(t.tenantId, t.itemId),
    inspectionIdx: index('ppe_issue_reports_inspection_idx').on(t.tenantId, t.inspectionId),
    reportedByIdx: index('ppe_issue_reports_reported_by_idx').on(
      t.tenantId,
      t.reportedByTenantUserId,
    ),
    tenantIdx: index('ppe_issue_reports_tenant_idx').on(t.tenantId),
    itemFk: foreignKey({
      name: 'ppe_issue_reports_tenant_item_fk',
      columns: [t.tenantId, t.itemId],
      foreignColumns: [ppeItems.tenantId, ppeItems.id],
    }).onDelete('cascade'),
    inspectionFk: foreignKey({
      name: 'ppe_issue_reports_tenant_inspection_fk',
      columns: [t.tenantId, t.inspectionId],
      foreignColumns: [ppeInspections.tenantId, ppeInspections.id],
    }),
    reportedByFk: foreignKey({
      name: 'ppe_issue_reports_tenant_reported_by_fk',
      columns: [t.tenantId, t.reportedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
  }),
)

export const ppeItemsRelations = relations(ppeItems, ({ one, many }) => ({
  tenant: one(tenants, { fields: [ppeItems.tenantId], references: [tenants.id] }),
  type: one(ppeTypes, {
    fields: [ppeItems.tenantId, ppeItems.typeId],
    references: [ppeTypes.tenantId, ppeTypes.id],
  }),
  currentHolder: one(people, {
    fields: [ppeItems.tenantId, ppeItems.currentHolderPersonId],
    references: [people.tenantId, people.id],
  }),
  issues: many(ppeIssues),
  inspections: many(ppeInspections),
  issueReports: many(ppeIssueReports),
}))

export const ppeTypesRelations = relations(ppeTypes, ({ one, many }) => ({
  tenant: one(tenants, { fields: [ppeTypes.tenantId], references: [tenants.id] }),
  items: many(ppeItems),
}))

export const ppeIssuesRelations = relations(ppeIssues, ({ one }) => ({
  item: one(ppeItems, {
    fields: [ppeIssues.tenantId, ppeIssues.itemId],
    references: [ppeItems.tenantId, ppeItems.id],
  }),
  person: one(people, {
    fields: [ppeIssues.tenantId, ppeIssues.personId],
    references: [people.tenantId, people.id],
  }),
  issuedBy: one(tenantUsers, {
    fields: [ppeIssues.tenantId, ppeIssues.issuedByTenantUserId],
    references: [tenantUsers.tenantId, tenantUsers.id],
  }),
}))

export const ppeInspectionsRelations = relations(ppeInspections, ({ one, many }) => ({
  item: one(ppeItems, {
    fields: [ppeInspections.tenantId, ppeInspections.itemId],
    references: [ppeItems.tenantId, ppeItems.id],
  }),
  inspectedBy: one(tenantUsers, {
    fields: [ppeInspections.tenantId, ppeInspections.inspectedByTenantUserId],
    references: [tenantUsers.tenantId, tenantUsers.id],
  }),
  criteria: many(ppeInspectionCriteria),
  attachments: many(ppeInspectionAttachments),
  issueReports: many(ppeIssueReports),
}))

export const ppeInspectionCriteriaRelations = relations(ppeInspectionCriteria, ({ one, many }) => ({
  inspection: one(ppeInspections, {
    fields: [ppeInspectionCriteria.tenantId, ppeInspectionCriteria.inspectionId],
    references: [ppeInspections.tenantId, ppeInspections.id],
  }),
  attachments: many(ppeInspectionAttachments),
}))

export const ppeInspectionAttachmentsRelations = relations(ppeInspectionAttachments, ({ one }) => ({
  inspection: one(ppeInspections, {
    fields: [ppeInspectionAttachments.tenantId, ppeInspectionAttachments.inspectionId],
    references: [ppeInspections.tenantId, ppeInspections.id],
  }),
  criterion: one(ppeInspectionCriteria, {
    fields: [ppeInspectionAttachments.tenantId, ppeInspectionAttachments.criterionResultId],
    references: [ppeInspectionCriteria.tenantId, ppeInspectionCriteria.id],
  }),
}))

export const ppeIssueReportsRelations = relations(ppeIssueReports, ({ one }) => ({
  item: one(ppeItems, {
    fields: [ppeIssueReports.tenantId, ppeIssueReports.itemId],
    references: [ppeItems.tenantId, ppeItems.id],
  }),
  reportedBy: one(tenantUsers, {
    fields: [ppeIssueReports.tenantId, ppeIssueReports.reportedByTenantUserId],
    references: [tenantUsers.tenantId, tenantUsers.id],
  }),
  inspection: one(ppeInspections, {
    fields: [ppeIssueReports.tenantId, ppeIssueReports.inspectionId],
    references: [ppeInspections.tenantId, ppeInspections.id],
  }),
}))
