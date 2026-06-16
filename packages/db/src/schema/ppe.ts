// PPE — separate from Equipment to preserve issue / return / discard lifecycle.

import { relations } from 'drizzle-orm'
import {
  boolean,
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
    inspectionSchedule: jsonb('inspection_schedule').$type<{
      cron?: string
      everyDays?: number
      templateKey?: string
    } | null>(),
    sizingScheme: jsonb('sizing_scheme').$type<string[] | null>(), // e.g. ['S','M','L','XL']
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('ppe_types_tenant_idx').on(t.tenantId),
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
    typeId: uuid('type_id')
      .notNull()
      .references(() => ppeTypes.id),
    serialNumber: text('serial_number'),
    size: text('size'),
    status: ppeItemStatus('status').default('in_stock').notNull(),
    // Draft-first (badged): instant-created items show in the register with a
    // "Draft" badge until completed — never hidden. Existing rows default false.
    isDraft: boolean('is_draft').default(false).notNull(),
    currentHolderPersonId: uuid('current_holder_person_id').references(() => people.id),
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
    typeIdx: index('ppe_items_type_idx').on(t.typeId),
    holderIdx: index('ppe_items_holder_idx').on(t.tenantId, t.currentHolderPersonId),
    tenantSerialUx: uniqueIndex('ppe_items_tenant_serial_ux').on(t.tenantId, t.serialNumber),
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
    itemId: uuid('item_id')
      .notNull()
      .references(() => ppeItems.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').references(() => people.id),
    action: ppeIssueAction('action').notNull(),
    quantity: integer('quantity').default(1).notNull(),
    issuedByTenantUserId: uuid('issued_by_tenant_user_id')
      .notNull()
      .references(() => tenantUsers.id),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    note: text('note'),
    receiptSignatureAttachmentId: uuid('receipt_signature_attachment_id'),
    ...timestamps,
  },
  (t) => ({
    itemIdx: index('ppe_issues_item_idx').on(t.itemId),
    personIdx: index('ppe_issues_person_idx').on(t.tenantId, t.personId),
    tenantIdx: index('ppe_issues_tenant_idx').on(t.tenantId),
  }),
)

// Inspection record (per-item, per-event). Pre-use or scheduled annual.
export const ppeInspectionKind = pgEnum('ppe_inspection_kind', ['pre_use', 'annual'])
export const ppeInspectionResult = pgEnum('ppe_inspection_result', ['pass', 'fail', 'n_a'])

export const ppeInspections = pgTable(
  'ppe_inspections',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => ppeItems.id, { onDelete: 'cascade' }),
    kind: ppeInspectionKind('kind').notNull(),
    result: ppeInspectionResult('result').notNull(),
    inspectedByTenantUserId: uuid('inspected_by_tenant_user_id').references(() => tenantUsers.id),
    inspectedOn: date('inspected_on').notNull(),
    nextDueOn: date('next_due_on'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    itemIdx: index('ppe_inspections_item_idx').on(t.itemId, t.inspectedOn),
    tenantIdx: index('ppe_inspections_tenant_idx').on(t.tenantId),
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
    itemId: uuid('item_id')
      .notNull()
      .references(() => ppeItems.id, { onDelete: 'cascade' }),
    reportedByTenantUserId: uuid('reported_by_tenant_user_id').references(() => tenantUsers.id),
    reportedAt: timestamp('reported_at', { withTimezone: true }).defaultNow().notNull(),
    description: text('description').notNull(),
    status: ppeIssueStatus('status').default('open').notNull(),
    resolution: text('resolution'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    itemIdx: index('ppe_issue_reports_item_idx').on(t.itemId),
    tenantIdx: index('ppe_issue_reports_tenant_idx').on(t.tenantId),
  }),
)

export const ppeItemsRelations = relations(ppeItems, ({ one, many }) => ({
  tenant: one(tenants, { fields: [ppeItems.tenantId], references: [tenants.id] }),
  type: one(ppeTypes, { fields: [ppeItems.typeId], references: [ppeTypes.id] }),
  currentHolder: one(people, {
    fields: [ppeItems.currentHolderPersonId],
    references: [people.id],
  }),
  issues: many(ppeIssues),
  inspections: many(ppeInspections),
  issueReports: many(ppeIssueReports),
}))

export const ppeTypesRelations = relations(ppeTypes, ({ one, many }) => ({
  tenant: one(tenants, { fields: [ppeTypes.tenantId], references: [tenants.id] }),
  items: many(ppeItems),
}))
