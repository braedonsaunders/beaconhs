// Inspection Records — a concrete inspection performed against an
// inspection_type. Maps to the legacy `inspections` table.
//
// Each record carries the inspector + supervisor + foreman + customer-sig
// metadata and a status enum (draft / in_progress / submitted / closed). The
// actual criterion responses live in inspection_record_criteria, which is
// materialised from the linked type+banks at record creation time.

import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
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
    typeId: uuid('type_id').notNull(),

    status: inspectionRecordStatus('status').default('draft').notNull(),
    locked: boolean('locked').default(false).notNull(),

    // When did the inspection actually happen (not when the row was created)
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),

    // The linked Location and the more specific free-text place on that
    // location are separate concepts. `siteOrgUnitId` drives tenant visibility
    // and grouping; `locationOnSite` preserves the detail entered by crews.
    siteOrgUnitId: uuid('site_org_unit_id'),
    locationOnSite: text('location_on_site'),

    // Who performed the inspection
    inspectorTenantUserId: uuid('inspector_tenant_user_id'),
    supervisorTenantUserId: uuid('supervisor_tenant_user_id'),

    // Foreman — legacy stored a comma-separated list of person ids in a JSON
    // string. We keep both: a structured array of person ids AND a freeform
    // text field for when the foreman isn't in our people directory.
    foremanPersonIds: jsonb('foreman_person_ids').$type<string[]>().default([]).notNull(),
    foremanText: text('foreman_text'),

    // Customer context — legacy `Customer` (location) + `CustomerContact`
    customerOrgUnitId: uuid('customer_org_unit_id'),
    customerContactPersonId: uuid('customer_contact_person_id'),
    customerContactName: text('customer_contact_name'),

    customerSignatureAttachmentId: uuid('customer_signature_attachment_id'),
    customerSignerName: text('customer_signer_name'),
    customerSignedAt: timestamp('customer_signed_at', { withTimezone: true }),

    // Free-form notes captured at the record level (vs per-criterion)
    notes: text('notes'),

    // Workflow milestones
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    submittedByTenantUserId: uuid('submitted_by_tenant_user_id'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedByTenantUserId: uuid('closed_by_tenant_user_id'),

    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),

    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('inspection_records_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('inspection_records_tenant_id_id_ux').on(t.tenantId, t.id),
    tenantReferenceUx: uniqueIndex('inspection_records_tenant_reference_ux').on(
      t.tenantId,
      t.reference,
    ),
    typeIdx: index('inspection_records_type_idx').on(t.tenantId, t.typeId),
    statusIdx: index('inspection_records_status_idx').on(t.tenantId, t.status),
    occurredIdx: index('inspection_records_occurred_idx').on(t.tenantId, t.occurredAt),
    siteIdx: index('inspection_records_site_idx').on(t.tenantId, t.siteOrgUnitId),
    inspectorIdx: index('inspection_records_inspector_idx').on(t.tenantId, t.inspectorTenantUserId),
    supervisorIdx: index('inspection_records_supervisor_idx').on(
      t.tenantId,
      t.supervisorTenantUserId,
    ),
    customerOrgIdx: index('inspection_records_customer_org_idx').on(
      t.tenantId,
      t.customerOrgUnitId,
    ),
    customerContactIdx: index('inspection_records_customer_contact_idx').on(
      t.tenantId,
      t.customerContactPersonId,
    ),
    submittedByIdx: index('inspection_records_submitted_by_idx').on(
      t.tenantId,
      t.submittedByTenantUserId,
    ),
    closedByIdx: index('inspection_records_closed_by_idx').on(t.tenantId, t.closedByTenantUserId),
    closedLockedCk: check(
      'inspection_records_closed_locked_ck',
      sql`${t.status} <> 'closed' OR ${t.locked}`,
    ),
    typeFk: foreignKey({
      name: 'inspection_records_tenant_type_fk',
      columns: [t.tenantId, t.typeId],
      foreignColumns: [inspectionTypes.tenantId, inspectionTypes.id],
    }),
    siteFk: foreignKey({
      name: 'inspection_records_tenant_site_fk',
      columns: [t.tenantId, t.siteOrgUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id],
    }),
    inspectorFk: foreignKey({
      name: 'inspection_records_tenant_inspector_fk',
      columns: [t.tenantId, t.inspectorTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    supervisorFk: foreignKey({
      name: 'inspection_records_tenant_supervisor_fk',
      columns: [t.tenantId, t.supervisorTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    customerOrgFk: foreignKey({
      name: 'inspection_records_tenant_customer_org_fk',
      columns: [t.tenantId, t.customerOrgUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id],
    }),
    customerContactFk: foreignKey({
      name: 'inspection_records_tenant_customer_contact_fk',
      columns: [t.tenantId, t.customerContactPersonId],
      foreignColumns: [people.tenantId, people.id],
    }),
    submittedByFk: foreignKey({
      name: 'inspection_records_tenant_submitted_by_fk',
      columns: [t.tenantId, t.submittedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    closedByFk: foreignKey({
      name: 'inspection_records_tenant_closed_by_fk',
      columns: [t.tenantId, t.closedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
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
    recordId: uuid('record_id').notNull(),
    attachmentId: uuid('attachment_id').notNull(),
    caption: text('caption'),
    ...timestamps,
  },
  (t) => ({
    recordAttachmentUx: uniqueIndex('inspection_record_attachments_record_attachment_ux').on(
      t.tenantId,
      t.recordId,
      t.attachmentId,
    ),
    recordFk: foreignKey({
      name: 'inspection_record_attachments_tenant_record_fk',
      columns: [t.tenantId, t.recordId],
      foreignColumns: [inspectionRecords.tenantId, inspectionRecords.id],
    }).onDelete('cascade'),
  }),
)

export const inspectionRecordsRelations = relations(inspectionRecords, ({ one, many }) => ({
  tenant: one(tenants, { fields: [inspectionRecords.tenantId], references: [tenants.id] }),
  type: one(inspectionTypes, {
    fields: [inspectionRecords.tenantId, inspectionRecords.typeId],
    references: [inspectionTypes.tenantId, inspectionTypes.id],
  }),
  site: one(orgUnits, {
    fields: [inspectionRecords.tenantId, inspectionRecords.siteOrgUnitId],
    references: [orgUnits.tenantId, orgUnits.id],
  }),
  inspector: one(tenantUsers, {
    fields: [inspectionRecords.tenantId, inspectionRecords.inspectorTenantUserId],
    references: [tenantUsers.tenantId, tenantUsers.id],
  }),
  attachments: many(inspectionRecordAttachments),
}))

export const inspectionRecordAttachmentsRelations = relations(
  inspectionRecordAttachments,
  ({ one }) => ({
    record: one(inspectionRecords, {
      fields: [inspectionRecordAttachments.tenantId, inspectionRecordAttachments.recordId],
      references: [inspectionRecords.tenantId, inspectionRecords.id],
    }),
  }),
)
