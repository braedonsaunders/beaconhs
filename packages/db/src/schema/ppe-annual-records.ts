// Per-item annual third-party inspection certificates.
//
// Unlike the pre-use checks in ppe_inspections, the annual record is the
// external-competent-person sign-off (e.g. harness annual by a certified
// rigger). It carries the certificate attachment + pass/fail + the next-due
// date that drives the expired/expiring reports.
//
// Legacy parity: the legacy app stored these mingled with regular inspection
// rows via PPEInspection.IntervalType = 'Annual' + a separate certificate
// upload. We promote the data model to a dedicated table because annual
// records have distinctly different fields (third-party inspector, certificate
// attachment, year-of-record) and they drive the compliance reports separately
// from the day-to-day pre-use log.

import { relations } from 'drizzle-orm'
import {
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { attachments } from './attachments'
import { tenants } from './core'
import { people } from './org'
import { ppeItems } from './ppe'

export const ppeAnnualRecordResult = pgEnum('ppe_annual_record_result', [
  'pass',
  'fail',
  'remediated',
])

export const ppeAnnualRecords = pgTable(
  'ppe_annual_records',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').notNull(),
    // Year-of-record — used by the per-item history rollup so the same item
    // can't have two annual certs for the same year (data-entry guard).
    year: text('year').notNull(),
    inspectedOn: date('inspected_on').notNull(),
    nextDueOn: date('next_due_on'),
    // The competent person who performed the inspection. Optional — sometimes
    // only a company name is recorded and we capture it in `notes`.
    inspectedByPersonId: uuid('inspected_by_person_id'),
    inspectorName: text('inspector_name'),
    inspectorCompany: text('inspector_company'),
    certificateAttachmentId: uuid('certificate_attachment_id'),
    result: ppeAnnualRecordResult('result').notNull(),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('ppe_annual_records_tenant_idx').on(t.tenantId),
    itemIdx: index('ppe_annual_records_item_idx').on(t.tenantId, t.itemId, t.inspectedOn),
    itemYearUx: uniqueIndex('ppe_annual_records_item_year_ux').on(t.tenantId, t.itemId, t.year),
    inspectedByIdx: index('ppe_annual_records_inspected_by_idx').on(
      t.tenantId,
      t.inspectedByPersonId,
    ),
    itemFk: foreignKey({
      name: 'ppe_annual_records_tenant_item_fk',
      columns: [t.tenantId, t.itemId],
      foreignColumns: [ppeItems.tenantId, ppeItems.id],
    }).onDelete('cascade'),
    inspectedByFk: foreignKey({
      name: 'ppe_annual_records_tenant_inspected_by_fk',
      columns: [t.tenantId, t.inspectedByPersonId],
      foreignColumns: [people.tenantId, people.id],
    }),
  }),
)

export const ppeAnnualRecordsRelations = relations(ppeAnnualRecords, ({ one }) => ({
  tenant: one(tenants, { fields: [ppeAnnualRecords.tenantId], references: [tenants.id] }),
  item: one(ppeItems, {
    fields: [ppeAnnualRecords.tenantId, ppeAnnualRecords.itemId],
    references: [ppeItems.tenantId, ppeItems.id],
  }),
  inspectedByPerson: one(people, {
    fields: [ppeAnnualRecords.tenantId, ppeAnnualRecords.inspectedByPersonId],
    references: [people.tenantId, people.id],
  }),
  certificate: one(attachments, {
    fields: [ppeAnnualRecords.tenantId, ppeAnnualRecords.certificateAttachmentId],
    references: [attachments.tenantId, attachments.id],
  }),
}))
