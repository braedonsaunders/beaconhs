// Equipment / asset register. QR-tagged items, location history, work orders.
// Inspections are form_responses pinned to equipment_id (sourceEntityType='equipment').

import { relations } from 'drizzle-orm'
import {
  boolean,
  date,
  doublePrecision,
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
import { id, softDelete, timestamps } from './_helpers'
import { tenants, tenantUsers, users as user } from './core'
import { orgUnits, people } from './org'

// Category lookup so admins can group equipment types into buckets
// ("Tools", "Vehicles", "Lifts", "Trailers", …) without committing to an
// enum.
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
    // Which optional field groups (see the web app's EQUIPMENT_FIELD_GROUPS
    // registry) render on items of this category. NULL = registry defaults, so
    // categories opt in/out of e.g. vehicle/meters/specs sections without
    // cluttering every asset with irrelevant inputs.
    enabledFieldGroups: jsonb('enabled_field_groups').$type<string[] | null>(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('equipment_categories_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('equipment_categories_tenant_id_id_ux').on(t.tenantId, t.id),
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
    // The physical tenant-aware key uses partial-column SET NULL so deleting a
    // category clears only category_id and keeps tenant_id intact.
    categoryId: uuid('category_id'),
    description: text('description'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('equipment_types_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('equipment_types_tenant_id_id_ux').on(t.tenantId, t.id),
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

export const equipmentOwnership = pgEnum('equipment_ownership', ['owned', 'rented', 'leased'])

export const equipmentItems = pgTable(
  'equipment_items',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    typeId: uuid('type_id'),
    // Per-item category. Legacy EQUIPMENT.Category is a free-text name set per
    // item, independent of Type (a generic type like "Cordless" spans 13
    // categories) — so category lives on the item, not derived through the type.
    // Nullable tenant-owned references whose parent deletion clears the
    // business ID use partial-column SET NULL constraints installed by SQL.
    categoryId: uuid('category_id'),
    assetTag: text('asset_tag').notNull(),
    serialNumber: text('serial_number'),
    name: text('name').notNull(),
    description: text('description'),
    // Free-form maintenance / status notes (legacy EQUIPMENT.Notes).
    notes: text('notes'),
    qrToken: text('qr_token').notNull(), // unique scannable token
    status: equipmentStatus('status').default('in_service').notNull(),
    // Draft-first (badged): instant-created items show in the register with a
    // "Draft" badge until completed — never hidden. Existing rows default false.
    isDraft: boolean('is_draft').default(false).notNull(),
    // ----- Manufacture (field group: manufacture) -----
    manufacturer: text('manufacturer'),
    model: text('model'),
    modelYear: integer('model_year'),
    // ----- Acquisition (field group: acquisition) -----
    // Purchase price is an informational asset attribute only — billing rates,
    // expenses, and every other financial concern live in the external
    // financial system, never here.
    purchaseDate: date('purchase_date'),
    purchasePrice: numeric('purchase_price', { precision: 12, scale: 2 }),
    purchaseVendor: text('purchase_vendor'),
    warrantyExpiresOn: date('warranty_expires_on'),
    // ----- Ownership (field group: ownership) -----
    ownership: equipmentOwnership('ownership').default('owned').notNull(),
    rentalProvider: text('rental_provider'),
    rentalEndsOn: date('rental_ends_on'),
    // ----- Road / registration (field group: vehicle) -----
    vin: text('vin'),
    licensePlate: text('license_plate'),
    registrationExpiresOn: date('registration_expires_on'),
    insuranceExpiresOn: date('insurance_expires_on'),
    // ----- Meters (field group: meters) -----
    currentHours: numeric('current_hours', { precision: 10, scale: 1 }),
    currentOdometer: integer('current_odometer'),
    metersUpdatedAt: timestamp('meters_updated_at', { withTimezone: true }),
    // ----- Specifications (field group: specifications) -----
    fuelType: text('fuel_type'),
    powerRating: text('power_rating'),
    capacity: text('capacity'),
    weight: text('weight'),
    dimensions: text('dimensions'),
    currentSiteOrgUnitId: uuid('current_site_org_unit_id'),
    currentHolderPersonId: uuid('current_holder_person_id'),
    photoAttachmentId: uuid('photo_attachment_id'),
    manualAttachmentId: uuid('manual_attachment_id'),
    // Pre-use inspections gate on each use rather than a calendar; recurring
    // calendar cadences live in equipment_inspection_schedules.
    requiresPreUseInspection: boolean('requires_pre_use_inspection').default(false).notNull(),
    // The pre-use checklist this unit uses. Plain uuid (no drizzle .references)
    // to avoid a schema-file import cycle — the FK to
    // equipment_inspection_types (ON DELETE SET NULL) is installed by migration.
    preUseInspectionTypeId: uuid('pre_use_inspection_type_id'),
    lastPreUseInspectionAt: timestamp('last_pre_use_inspection_at', { withTimezone: true }),
    isMissing: boolean('is_missing').default(false).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastSeenSiteOrgUnitId: uuid('last_seen_site_org_unit_id'),
    lastSeenHolderPersonId: uuid('last_seen_holder_person_id'),
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
    // ----- Oil-change schedule (drives upcoming-oil-change report) -----
    requiresOilChange: boolean('requires_oil_change').default(false).notNull(),
    oilChangeIntervalMonths: integer('oil_change_interval_months'),
    lastOilChangeOn: date('last_oil_change_on'),
    nextOilChangeDue: date('next_oil_change_due'),
    // ----- Bulk-QR support -----
    // Token stamped on bulk-QR sheets so the same printed page can be
    // re-issued without regenerating each label. Distinct from `qrToken`
    // which is per-item and scanned during pre-use inspection.
    bulkQrToken: text('bulk_qr_token'),
    bulkQrGeneratedAt: timestamp('bulk_qr_generated_at', { withTimezone: true }),
    // ----- Availability shortcut for the "available for checkout" filter -----
    // When `currentHolderPersonId` is null AND status='in_service' AND
    // `isMissing` is false AND there is no open checkout row, the item is
    // considered available; we cache the computed flag here so the list page
    // can filter without repeating the custody sub-query.
    isAvailableForCheckout: boolean('is_available_for_checkout').default(true).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantTagUx: uniqueIndex('equipment_items_tenant_tag_ux').on(t.tenantId, t.assetTag),
    tenantIdIdUx: uniqueIndex('equipment_items_tenant_id_id_ux').on(t.tenantId, t.id),
    qrUx: uniqueIndex('equipment_items_qr_ux').on(t.qrToken),
    tenantIdx: index('equipment_items_tenant_idx').on(t.tenantId),
    typeIdx: index('equipment_items_type_idx').on(t.tenantId, t.typeId),
    siteIdx: index('equipment_items_site_idx').on(t.tenantId, t.currentSiteOrgUnitId),
    holderIdx: index('equipment_items_holder_idx').on(t.tenantId, t.currentHolderPersonId),
    lastSeenSiteIdx: index('equipment_items_last_seen_site_idx').on(
      t.tenantId,
      t.lastSeenSiteOrgUnitId,
    ),
    lastSeenHolderIdx: index('equipment_items_last_seen_holder_idx').on(
      t.tenantId,
      t.lastSeenHolderPersonId,
    ),
    preUseInspectionTypeIdx: index('equipment_items_pre_use_inspection_type_idx').on(
      t.tenantId,
      t.preUseInspectionTypeId,
    ),
    availableIdx: index('equipment_items_available_idx').on(t.tenantId, t.isAvailableForCheckout),
    categoryIdx: index('equipment_items_category_idx').on(t.tenantId, t.categoryId),
    typeFk: foreignKey({
      name: 'equipment_items_tenant_type_fk',
      columns: [t.tenantId, t.typeId],
      foreignColumns: [equipmentTypes.tenantId, equipmentTypes.id],
    }),
    currentSiteFk: foreignKey({
      name: 'equipment_items_tenant_current_site_fk',
      columns: [t.tenantId, t.currentSiteOrgUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id],
    }),
    currentHolderFk: foreignKey({
      name: 'equipment_items_tenant_current_holder_fk',
      columns: [t.tenantId, t.currentHolderPersonId],
      foreignColumns: [people.tenantId, people.id],
    }),
    lastSeenSiteFk: foreignKey({
      name: 'equipment_items_tenant_last_seen_site_fk',
      columns: [t.tenantId, t.lastSeenSiteOrgUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id],
    }),
    lastSeenHolderFk: foreignKey({
      name: 'equipment_items_tenant_last_seen_holder_fk',
      columns: [t.tenantId, t.lastSeenHolderPersonId],
      foreignColumns: [people.tenantId, people.id],
    }),
    // Accelerate jsonb containment over custom-field values (metadata.custom).
    metadataGin: index('equipment_items_metadata_gin').using('gin', t.metadata),
  }),
)

export const equipmentLocationHistory = pgTable(
  'equipment_location_history',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').notNull(),
    siteOrgUnitId: uuid('site_org_unit_id'),
    holderPersonId: uuid('holder_person_id'),
    geoLat: doublePrecision('geo_lat'),
    geoLng: doublePrecision('geo_lng'),
    recordedByTenantUserId: uuid('recorded_by_tenant_user_id'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
    note: text('note'),
  },
  (t) => ({
    itemIdx: index('equipment_location_history_item_idx').on(t.tenantId, t.itemId, t.recordedAt),
    tenantIdx: index('equipment_location_history_tenant_idx').on(t.tenantId),
    siteIdx: index('equipment_location_history_site_idx').on(t.tenantId, t.siteOrgUnitId),
    holderIdx: index('equipment_location_history_holder_idx').on(t.tenantId, t.holderPersonId),
    recordedByIdx: index('equipment_location_history_recorded_by_idx').on(
      t.tenantId,
      t.recordedByTenantUserId,
    ),
    itemFk: foreignKey({
      name: 'equipment_location_history_tenant_item_fk',
      columns: [t.tenantId, t.itemId],
      foreignColumns: [equipmentItems.tenantId, equipmentItems.id],
    }).onDelete('cascade'),
    siteFk: foreignKey({
      name: 'equipment_location_history_tenant_site_fk',
      columns: [t.tenantId, t.siteOrgUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id],
    }),
    holderFk: foreignKey({
      name: 'equipment_location_history_tenant_holder_fk',
      columns: [t.tenantId, t.holderPersonId],
      foreignColumns: [people.tenantId, people.id],
    }),
    recordedByFk: foreignKey({
      name: 'equipment_location_history_tenant_recorded_by_fk',
      columns: [t.tenantId, t.recordedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
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
    itemId: uuid('item_id').notNull(),
    reference: text('reference').notNull(),
    status: workOrderStatus('status').default('open').notNull(),
    priority: workOrderPriority('priority').default('med').notNull(),
    summary: text('summary').notNull(),
    description: text('description'),
    actionTaken: text('action_taken'),
    cost: numeric('cost', { precision: 12, scale: 2 }),
    reportedByPersonId: uuid('reported_by_person_id'),
    openedByTenantUserId: uuid('opened_by_tenant_user_id'),
    assignedToTenantUserId: uuid('assigned_to_tenant_user_id'),
    openedAt: timestamp('opened_at', { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    itemIdx: index('equipment_work_orders_item_idx').on(t.tenantId, t.itemId),
    statusIdx: index('equipment_work_orders_status_idx').on(t.tenantId, t.status),
    tenantIdx: index('equipment_work_orders_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('equipment_work_orders_tenant_id_id_ux').on(t.tenantId, t.id),
    priorityIdx: index('equipment_work_orders_priority_idx').on(t.tenantId, t.priority),
    reportedByIdx: index('equipment_work_orders_reported_by_idx').on(
      t.tenantId,
      t.reportedByPersonId,
    ),
    openedByIdx: index('equipment_work_orders_opened_by_idx').on(
      t.tenantId,
      t.openedByTenantUserId,
    ),
    assignedToIdx: index('equipment_work_orders_assigned_to_idx').on(
      t.tenantId,
      t.assignedToTenantUserId,
    ),
    itemFk: foreignKey({
      name: 'equipment_work_orders_tenant_item_fk',
      columns: [t.tenantId, t.itemId],
      foreignColumns: [equipmentItems.tenantId, equipmentItems.id],
    }).onDelete('cascade'),
    reportedByFk: foreignKey({
      name: 'equipment_work_orders_tenant_reported_by_fk',
      columns: [t.tenantId, t.reportedByPersonId],
      foreignColumns: [people.tenantId, people.id],
    }),
    openedByFk: foreignKey({
      name: 'equipment_work_orders_tenant_opened_by_fk',
      columns: [t.tenantId, t.openedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    assignedToFk: foreignKey({
      name: 'equipment_work_orders_tenant_assigned_to_fk',
      columns: [t.tenantId, t.assignedToTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
  }),
)

export const equipmentItemsRelations = relations(equipmentItems, ({ one, many }) => ({
  tenant: one(tenants, { fields: [equipmentItems.tenantId], references: [tenants.id] }),
  type: one(equipmentTypes, {
    fields: [equipmentItems.tenantId, equipmentItems.typeId],
    references: [equipmentTypes.tenantId, equipmentTypes.id],
  }),
  category: one(equipmentCategories, {
    fields: [equipmentItems.tenantId, equipmentItems.categoryId],
    references: [equipmentCategories.tenantId, equipmentCategories.id],
  }),
  currentSite: one(orgUnits, {
    fields: [equipmentItems.tenantId, equipmentItems.currentSiteOrgUnitId],
    references: [orgUnits.tenantId, orgUnits.id],
  }),
  currentHolder: one(people, {
    fields: [equipmentItems.tenantId, equipmentItems.currentHolderPersonId],
    references: [people.tenantId, people.id],
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
    fields: [equipmentTypes.tenantId, equipmentTypes.categoryId],
    references: [equipmentCategories.tenantId, equipmentCategories.id],
  }),
  items: many(equipmentItems),
}))
