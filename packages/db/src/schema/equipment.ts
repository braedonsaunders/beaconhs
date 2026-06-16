// Equipment / asset register. QR-tagged items, location history, work orders.
// Inspections are form_responses pinned to equipment_id (sourceEntityType='equipment').

import { relations } from 'drizzle-orm'
import {
  boolean,
  date,
  doublePrecision,
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
import { tenants, tenantUsers, user } from './core'
import { orgUnits, people } from './org'

// Free-form category lookup so admins can group equipment types into buckets
// ("Tools", "Vehicles", "Lifts", "Trailers", …) without committing to an
// enum. Equipment types still keep a `category` string for backwards-
// compatibility with the legacy column; this table is the canonical source.
export const equipmentCategories = pgTable(
  'equipment_categories',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('equipment_categories_tenant_idx').on(t.tenantId),
    tenantSlugUx: uniqueIndex('equipment_categories_tenant_slug_ux').on(t.tenantId, t.slug),
  }),
)

export const equipmentTypes = pgTable(
  'equipment_types',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category'), // 'tool' | 'vehicle' | 'machinery' | …
    // FK to the lookup table when the category exists there. The free-form
    // `category` text above stays as a fallback for legacy rows.
    categoryId: uuid('category_id').references(() => equipmentCategories.id, {
      onDelete: 'set null',
    }),
    description: text('description'),
    requiresPreUseInspection: jsonb('requires_pre_use_inspection').$type<{
      templateKey?: string
    } | null>(),
    inspectionSchedule: jsonb('inspection_schedule').$type<{
      cron?: string
      everyDays?: number
      templateKey?: string
    } | null>(),
    // Default oil-change interval (in months) for items of this type.
    defaultOilChangeIntervalMonths: integer('default_oil_change_interval_months'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('equipment_types_tenant_idx').on(t.tenantId),
    catIdx: index('equipment_types_cat_idx').on(t.tenantId, t.categoryId),
  }),
)

export const equipmentStatus = pgEnum('equipment_status', [
  'in_service',
  'out_of_service',
  'in_repair',
  'lost',
  'retired',
])

export const equipmentItems = pgTable(
  'equipment_items',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    typeId: uuid('type_id').references(() => equipmentTypes.id),
    assetTag: text('asset_tag').notNull(),
    serialNumber: text('serial_number'),
    name: text('name').notNull(),
    description: text('description'),
    qrToken: text('qr_token').notNull(), // unique scannable token
    status: equipmentStatus('status').default('in_service').notNull(),
    // Draft-first (badged): instant-created items show in the register with a
    // "Draft" badge until completed — never hidden. Existing rows default false.
    isDraft: boolean('is_draft').default(false).notNull(),
    purchaseDate: date('purchase_date'),
    warrantyExpiresOn: date('warranty_expires_on'),
    currentSiteOrgUnitId: uuid('current_site_org_unit_id').references(() => orgUnits.id),
    currentHolderPersonId: uuid('current_holder_person_id').references(() => people.id),
    photoAttachmentId: uuid('photo_attachment_id'),
    manualAttachmentId: uuid('manual_attachment_id'),
    requiresPreUseInspection: boolean('requires_pre_use_inspection').default(false).notNull(),
    preUseInspectionTemplateKey: text('pre_use_inspection_template_key'),
    lastPreUseInspectionAt: timestamp('last_pre_use_inspection_at', { withTimezone: true }),
    requiresAnnualInspection: boolean('requires_annual_inspection').default(false).notNull(),
    lastAnnualInspectionOn: date('last_annual_inspection_on'),
    nextAnnualInspectionDue: date('next_annual_inspection_due'),
    isMissing: boolean('is_missing').default(false).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastSeenSiteOrgUnitId: uuid('last_seen_site_org_unit_id').references(() => orgUnits.id),
    lastSeenHolderPersonId: uuid('last_seen_holder_person_id').references(() => people.id),
    // ----- Report-missing / report-found workflow -----
    // Set when a user files a "report missing" with last seen date / location /
    // notes; cleared (with `missingFoundAt` set) when the item is reported
    // found. Distinct from `lastSeenAt` above (which is a generic last-touch
    // timestamp updated by transfers / checkouts).
    missingReportedAt: timestamp('missing_reported_at', { withTimezone: true }),
    missingReportedBy: text('missing_reported_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    missingLastSeenAt: date('missing_last_seen_at'),
    missingLastSeenLocation: text('missing_last_seen_location'),
    missingNotes: text('missing_notes'),
    missingFoundAt: timestamp('missing_found_at', { withTimezone: true }),
    billingRateCategory: text('billing_rate_category'),
    // ----- Oil-change schedule (drives upcoming-oil-change report) -----
    requiresOilChange: boolean('requires_oil_change').default(false).notNull(),
    oilChangeIntervalMonths: integer('oil_change_interval_months'),
    lastOilChangeOn: date('last_oil_change_on'),
    nextOilChangeDue: date('next_oil_change_due'),
    // ----- Purchase economics (drives ROI report) -----
    purchasePrice: numeric('purchase_price', { precision: 12, scale: 2 }),
    // ----- Bulk-QR support -----
    // Token stamped on bulk-QR sheets so the same printed page can be
    // re-issued without regenerating each label. Distinct from `qrToken`
    // which is per-item and scanned during pre-use inspection.
    bulkQrToken: text('bulk_qr_token'),
    bulkQrGeneratedAt: timestamp('bulk_qr_generated_at', { withTimezone: true }),
    // ----- Availability shortcut for the "available for check-in" filter -----
    // When `currentHolderPersonId` is null AND status='in_service' AND
    // `isMissing` is false the item is considered available; we cache the
    // computed flag here so the list page can filter without a sub-query.
    isAvailableForCheckout: boolean('is_available_for_checkout').default(true).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantTagUx: uniqueIndex('equipment_items_tenant_tag_ux').on(t.tenantId, t.assetTag),
    qrUx: uniqueIndex('equipment_items_qr_ux').on(t.qrToken),
    tenantIdx: index('equipment_items_tenant_idx').on(t.tenantId),
    siteIdx: index('equipment_items_site_idx').on(t.tenantId, t.currentSiteOrgUnitId),
    availableIdx: index('equipment_items_available_idx').on(t.tenantId, t.isAvailableForCheckout),
  }),
)

export const equipmentLocationHistory = pgTable(
  'equipment_location_history',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => equipmentItems.id, { onDelete: 'cascade' }),
    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id),
    holderPersonId: uuid('holder_person_id').references(() => people.id),
    geoLat: doublePrecision('geo_lat'),
    geoLng: doublePrecision('geo_lng'),
    recordedByTenantUserId: uuid('recorded_by_tenant_user_id').references(() => tenantUsers.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
    note: text('note'),
  },
  (t) => ({
    itemIdx: index('equipment_location_history_item_idx').on(t.itemId, t.recordedAt),
    tenantIdx: index('equipment_location_history_tenant_idx').on(t.tenantId),
  }),
)

export const workOrderStatus = pgEnum('work_order_status', [
  'open',
  'assigned',
  'in_progress',
  'awaiting_parts',
  'repaired',
  'verified',
  'closed',
  'cancelled',
])

export const workOrderPriority = pgEnum('work_order_priority', ['low', 'med', 'high'])

export const equipmentWorkOrders = pgTable(
  'equipment_work_orders',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => equipmentItems.id, { onDelete: 'cascade' }),
    reference: text('reference').notNull(),
    status: workOrderStatus('status').default('open').notNull(),
    priority: workOrderPriority('priority').default('med').notNull(),
    summary: text('summary').notNull(),
    description: text('description'),
    actionTaken: text('action_taken'),
    cost: numeric('cost', { precision: 12, scale: 2 }),
    reportedByPersonId: uuid('reported_by_person_id').references(() => people.id),
    openedByTenantUserId: uuid('opened_by_tenant_user_id').references(() => tenantUsers.id),
    assignedToTenantUserId: uuid('assigned_to_tenant_user_id').references(() => tenantUsers.id),
    openedAt: timestamp('opened_at', { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    itemIdx: index('equipment_work_orders_item_idx').on(t.itemId),
    statusIdx: index('equipment_work_orders_status_idx').on(t.tenantId, t.status),
    tenantIdx: index('equipment_work_orders_tenant_idx').on(t.tenantId),
    priorityIdx: index('equipment_work_orders_priority_idx').on(t.tenantId, t.priority),
  }),
)

export const equipmentItemsRelations = relations(equipmentItems, ({ one, many }) => ({
  tenant: one(tenants, { fields: [equipmentItems.tenantId], references: [tenants.id] }),
  type: one(equipmentTypes, {
    fields: [equipmentItems.typeId],
    references: [equipmentTypes.id],
  }),
  currentSite: one(orgUnits, {
    fields: [equipmentItems.currentSiteOrgUnitId],
    references: [orgUnits.id],
  }),
  currentHolder: one(people, {
    fields: [equipmentItems.currentHolderPersonId],
    references: [people.id],
  }),
  history: many(equipmentLocationHistory),
  workOrders: many(equipmentWorkOrders),
}))

export const equipmentCategoriesRelations = relations(equipmentCategories, ({ many }) => ({
  types: many(equipmentTypes),
}))

export const equipmentTypesRelations = relations(equipmentTypes, ({ one, many }) => ({
  tenant: one(tenants, { fields: [equipmentTypes.tenantId], references: [tenants.id] }),
  category: one(equipmentCategories, {
    fields: [equipmentTypes.categoryId],
    references: [equipmentCategories.id],
  }),
  items: many(equipmentItems),
}))
