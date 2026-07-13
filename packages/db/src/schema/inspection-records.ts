// Inspection Records — a concrete inspection performed against an
// inspection_type. Maps to the legacy `inspections` table.
//
// Each record carries the inspector + supervisor + foreman + customer-sig
// metadata and a status enum (draft / in_progress / submitted / closed). The
// actual criterion responses live in inspection_record_criteria, which is
// materialised from the linked type+banks at record creation time.

import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
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
import { orgUnits, people } from './org'
import { inspectionTypes } from './inspection-types'

export const inspectionRecordStatus = pgEnum('inspection_record_status', [
  'draft',
  'in_progress',
  'submitted',
  'closed',
])

export const inspectionRecords = pgTable(
  'inspection_records',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    reference: text('reference').notNull(), // e.g. INS-2026-0001
    typeId: uuid('type_id')
      .notNull()
      .references(() => inspectionTypes.id),

    status: inspectionRecordStatus('status').default('draft').notNull(),
    locked: boolean('locked').default(false).notNull(),

    // When did the inspection actually happen (not when the row was created)
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),

    // Site / location
    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id),

    // Who performed the inspection
    inspectorTenantUserId: uuid('inspector_tenant_user_id').references(() => tenantUsers.id),
    supervisorTenantUserId: uuid('supervisor_tenant_user_id').references(() => tenantUsers.id),

    // Foreman — legacy stored a comma-separated list of person ids in a JSON
    // string. We keep both: a structured array of person ids AND a freeform
    // text field for when the foreman isn't in our people directory.
    foremanPersonIds: jsonb('foreman_person_ids').$type<string[]>().default([]).notNull(),
    foremanText: text('foreman_text'),

    // Customer context — legacy `Customer` (location) + `CustomerContact`
    customerOrgUnitId: uuid('customer_org_unit_id').references(() => orgUnits.id),
    customerContactPersonId: uuid('customer_contact_person_id').references(() => people.id),
    customerContactName: text('customer_contact_name'),

    customerSignatureAttachmentId: uuid('customer_signature_attachment_id'),
    customerSignerName: text('customer_signer_name'),
    customerSignedAt: timestamp('customer_signed_at', { withTimezone: true }),

    // Free-form notes captured at the record level (vs per-criterion)
    notes: text('notes'),

    // Workflow milestones
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    submittedByTenantUserId: uuid('submitted_by_tenant_user_id').references(() => tenantUsers.id),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedByTenantUserId: uuid('closed_by_tenant_user_id').references(() => tenantUsers.id),

    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),

    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('inspection_records_tenant_idx').on(t.tenantId),
    tenantReferenceUx: uniqueIndex('inspection_records_tenant_reference_ux').on(
      t.tenantId,
      t.reference,
    ),
    typeIdx: index('inspection_records_type_idx').on(t.tenantId, t.typeId),
    statusIdx: index('inspection_records_status_idx').on(t.tenantId, t.status),
    occurredIdx: index('inspection_records_occurred_idx').on(t.tenantId, t.occurredAt),
    siteIdx: index('inspection_records_site_idx').on(t.tenantId, t.siteOrgUnitId),
    inspectorIdx: index('inspection_records_inspector_idx').on(t.tenantId, t.inspectorTenantUserId),
  }),
)

// Photos attached to the inspection record as a whole (not pinned to a
// criterion). Mirrors `incident_attachments` so the photo-uploader UI can be
// reused as-is.
export const inspectionRecordAttachments = pgTable(
  'inspection_record_attachments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => inspectionRecords.id, { onDelete: 'cascade' }),
    attachmentId: uuid('attachment_id').notNull(),
    caption: text('caption'),
    ...timestamps,
  },
  (t) => ({
    recordIdx: index('inspection_record_attachments_record_idx').on(t.recordId),
    tenantIdx: index('inspection_record_attachments_tenant_idx').on(t.tenantId),
  }),
)

export const inspectionRecordsRelations = relations(inspectionRecords, ({ one, many }) => ({
  tenant: one(tenants, { fields: [inspectionRecords.tenantId], references: [tenants.id] }),
  type: one(inspectionTypes, {
    fields: [inspectionRecords.typeId],
    references: [inspectionTypes.id],
  }),
  site: one(orgUnits, {
    fields: [inspectionRecords.siteOrgUnitId],
    references: [orgUnits.id],
  }),
  inspector: one(tenantUsers, {
    fields: [inspectionRecords.inspectorTenantUserId],
    references: [tenantUsers.id],
  }),
  attachments: many(inspectionRecordAttachments),
}))

export const inspectionRecordAttachmentsRelations = relations(
  inspectionRecordAttachments,
  ({ one }) => ({
    record: one(inspectionRecords, {
      fields: [inspectionRecordAttachments.recordId],
      references: [inspectionRecords.id],
    }),
  }),
)
