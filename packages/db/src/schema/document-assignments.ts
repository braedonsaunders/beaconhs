// Document Assignments — explicit "this document must be acknowledged by X"
// records that aggregate over role keys, trade ids, department ids, and
// individual people. Compliance % is computed by joining the resolved audience
// against `document_acknowledgments`.
//
// Mirrors the legacy DOCUMENTATIONASSIGNMENT + DOCUMENTATIONASSIGNMENTRECORD
// tables — assignment rows are 1:1 with the assignment as a whole, and
// `audience` items are normalized into a child table so the audience can mix
// types (a role, plus a department, plus three people).

import { relations } from 'drizzle-orm'
import { date, index, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants, tenantUsers } from './core'
import { documents } from './documents'

export const documentAssignmentAudienceType = pgEnum('document_assignment_audience_type', [
  'role',
  'trade',
  'department',
  'person',
  'everyone',
])

export const documentAssignments = pgTable(
  'document_assignments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    title: text('title'), // optional human-friendly label; defaults to document title
    notes: text('notes'),
    dueOn: date('due_on'),
    assignedByTenantUserId: uuid('assigned_by_tenant_user_id').references(() => tenantUsers.id),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('document_assignments_tenant_idx').on(t.tenantId),
    docIdx: index('document_assignments_doc_idx').on(t.tenantId, t.documentId),
    dueIdx: index('document_assignments_due_idx').on(t.tenantId, t.dueOn),
  }),
)

export const documentAssignmentAudience = pgTable(
  'document_assignment_audience',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => documentAssignments.id, { onDelete: 'cascade' }),
    type: documentAssignmentAudienceType('type').notNull(),
    // For 'role' rows we store the role key (since role rows are tenant-local
    // and role keys are stable); for 'trade' / 'department' / 'person' we store
    // the uuid as text (kept as text for uniformity — the type column tells the
    // caller how to dereference it). For 'everyone' the value is the literal
    // string 'all'.
    entityKey: text('entity_key').notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('document_assignment_audience_tenant_idx').on(t.tenantId),
    assignmentIdx: index('document_assignment_audience_assignment_idx').on(t.assignmentId),
    uniqueUx: uniqueIndex('document_assignment_audience_unique_ux').on(
      t.assignmentId,
      t.type,
      t.entityKey,
    ),
  }),
)

export const documentAssignmentsRelations = relations(documentAssignments, ({ one, many }) => ({
  tenant: one(tenants, { fields: [documentAssignments.tenantId], references: [tenants.id] }),
  document: one(documents, {
    fields: [documentAssignments.documentId],
    references: [documents.id],
  }),
  audience: many(documentAssignmentAudience),
}))

export const documentAssignmentAudienceRelations = relations(
  documentAssignmentAudience,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [documentAssignmentAudience.tenantId],
      references: [tenants.id],
    }),
    assignment: one(documentAssignments, {
      fields: [documentAssignmentAudience.assignmentId],
      references: [documentAssignments.id],
    }),
  }),
)
