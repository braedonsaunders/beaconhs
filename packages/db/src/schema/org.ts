// Org hierarchy + people. Hierarchy depth is tenant-configurable
// (customer / project / site / area) but always lives in one self-referential table.

import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { catalogNameIsNonblankSql, normalizedCatalogNameSql } from '../catalog-name'
import { tenants, users } from './core'

export const orgUnitLevel = pgEnum('org_unit_level', ['customer', 'project', 'site', 'area'])

export const orgUnits = pgTable(
  'org_units',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    level: orgUnitLevel('level').notNull(),
    name: text('name').notNull(),
    code: text('code'), // tenant-defined short code
    // Site-level only: geolocation for GPS auto-suggest
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    geofenceMeters: integer('geofence_meters'),
    // Equipment check-in/out: when true, an asset sitting at this org-unit with
    // no holder counts as "checked in" (at base / in stock). Tenants flag their
    // shop/yard/crib here; everywhere else is treated as "deployed / out".
    isEquipmentBase: boolean('is_equipment_base').default(false).notNull(),
    address: jsonb('address').$type<{
      line1?: string
      line2?: string
      city?: string
      region?: string
      postal?: string
      country?: string
    }>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('org_units_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('org_units_tenant_id_id_ux').on(t.tenantId, t.id),
    parentIdx: index('org_units_parent_idx').on(t.tenantId, t.parentId),
    tenantLevelIdx: index('org_units_tenant_level_idx').on(t.tenantId, t.level),
    tenantCodeUx: uniqueIndex('org_units_tenant_code_ux').on(t.tenantId, t.code),
    metadataGin: index('org_units_metadata_gin').using('gin', t.metadata),
    parentFk: foreignKey({
      name: 'org_units_tenant_parent_fk',
      columns: [t.tenantId, t.parentId],
      foreignColumns: [t.tenantId, t.id],
    }).onDelete('cascade'),
  }),
)

export const departments = pgTable(
  'departments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code'),
    description: text('description'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('departments_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('departments_tenant_id_id_ux').on(t.tenantId, t.id),
    tenantNormalizedNameUx: uniqueIndex('departments_tenant_normalized_name_ux').on(
      t.tenantId,
      normalizedCatalogNameSql(t.name),
    ),
    nameNonblank: check('departments_name_nonblank_ck', catalogNameIsNonblankSql(t.name)),
  }),
)

export const trades = pgTable(
  'trades',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('trades_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('trades_tenant_id_id_ux').on(t.tenantId, t.id),
    tenantNormalizedNameUx: uniqueIndex('trades_tenant_normalized_name_ux').on(
      t.tenantId,
      normalizedCatalogNameSql(t.name),
    ),
    nameNonblank: check('trades_name_nonblank_ck', catalogNameIsNonblankSql(t.name)),
  }),
)

export const crews = pgTable(
  'crews',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('crews_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('crews_tenant_id_id_ux').on(t.tenantId, t.id),
    tenantNormalizedNameUx: uniqueIndex('crews_tenant_normalized_name_ux').on(
      t.tenantId,
      normalizedCatalogNameSql(t.name),
    ),
    nameNonblank: check('crews_name_nonblank_ck', catalogNameIsNonblankSql(t.name)),
  }),
)

export const peopleStatus = pgEnum('people_status', ['active', 'inactive', 'terminated'])

export const people = pgTable(
  'people',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // Optional link to a system user (workers without app access have no userId)
    userId: text('user_id').references(() => users.id),
    employeeNo: text('employee_no'),
    // External-system employee key (e.g. a NetSuite internal id / payroll id).
    // App-owned, optional; consumed by outbound integrations such as the
    // training-time export so they can post against the external HR/payroll id.
    externalEmployeeId: text('external_employee_id'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    formalName: text('formal_name'),
    dateOfBirth: date('date_of_birth'),
    hireDate: date('hire_date'),
    terminationDate: date('termination_date'),
    departmentId: uuid('department_id'),
    tradeId: uuid('trade_id'),
    crewId: uuid('crew_id'),
    email: text('email'),
    phone: text('phone'),
    photoAttachmentId: uuid('photo_attachment_id'),
    // Self-referential reporting line. Nullable for top-level reports
    // (executives, contractors without a manager). The org-chart page builds
    // a tree from this column with a simple in-memory cycle guard.
    managerPersonId: uuid('manager_person_id'),
    // User's saved signature image — referenced by inspection / form-sign-off
    // flows when this person is the signer. Stored as a regular attachment so
    // it benefits from the same upload + audit pipeline.
    signatureAttachmentId: uuid('signature_attachment_id'),
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    // Unguessable token behind the printed ID badge QR — opens the person's
    // PUBLIC live training transcript (/verify/person/<token>). Generated
    // lazily the first time a badge is printed; same model as the training
    // certificate verifyToken (randomBytes(20) hex).
    badgeToken: text('badge_token'),
    notes: text('notes'),
    status: peopleStatus('status').default('active').notNull(),
    // Denormalised caches synced by the people-groups / people-titles server
    // actions. These let list pages filter by group / title without a 3-way
    // join. The source of truth is still the membership / assignment tables —
    // these arrays are rewritten whenever a membership / assignment changes.
    groupIds: jsonb('group_ids').$type<string[]>().default([]).notNull(),
    titleIds: jsonb('title_ids').$type<string[]>().default([]).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('people_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('people_tenant_id_id_ux').on(t.tenantId, t.id),
    tenantEmployeeNoUx: uniqueIndex('people_tenant_employee_no_ux').on(t.tenantId, t.employeeNo),
    nameIdx: index('people_name_idx').on(t.tenantId, t.lastName, t.firstName),
    departmentIdx: index('people_department_idx').on(t.tenantId, t.departmentId),
    tradeIdx: index('people_trade_idx').on(t.tenantId, t.tradeId),
    crewIdx: index('people_crew_idx').on(t.tenantId, t.crewId),
    managerIdx: index('people_manager_idx').on(t.tenantId, t.managerPersonId),
    // Reverse-lookup index for "user → person" resolution (compliance audience,
    // notification recipients, flows delivery) which join people by userId.
    userIdx: index('people_user_idx').on(t.userId),
    // A login account maps to AT MOST one active person per tenant. Enforces the
    // 1:1 assumption baked into every `people.userId = <session user>` lookup.
    // Partial so soft-deleted rows and the many login-less workers (null userId)
    // don't collide.
    tenantUserUx: uniqueIndex('people_tenant_user_ux')
      .on(t.tenantId, t.userId)
      .where(sql`${t.userId} is not null and ${t.deletedAt} is null`),
    metadataGin: index('people_metadata_gin').using('gin', t.metadata),
    // Badge tokens resolve people on a PUBLIC page, so they must be globally
    // unique (cross-tenant). Partial: most workers never have a badge printed.
    badgeTokenUx: uniqueIndex('people_badge_token_ux')
      .on(t.badgeToken)
      .where(sql`${t.badgeToken} is not null`),
    departmentFk: foreignKey({
      name: 'people_tenant_department_fk',
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
    }),
    tradeFk: foreignKey({
      name: 'people_tenant_trade_fk',
      columns: [t.tenantId, t.tradeId],
      foreignColumns: [trades.tenantId, trades.id],
    }),
    crewFk: foreignKey({
      name: 'people_tenant_crew_fk',
      columns: [t.tenantId, t.crewId],
      foreignColumns: [crews.tenantId, crews.id],
    }),
    managerFk: foreignKey({
      name: 'people_tenant_manager_fk',
      columns: [t.tenantId, t.managerPersonId],
      foreignColumns: [t.tenantId, t.id],
    }),
  }),
)

export const peopleAssignments = pgTable(
  'people_assignments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').notNull(),
    orgUnitId: uuid('org_unit_id').notNull(),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('people_assignments_tenant_idx').on(t.tenantId),
    personIdx: index('people_assignments_person_idx').on(t.tenantId, t.personId),
    orgIdx: index('people_assignments_org_idx').on(t.tenantId, t.orgUnitId),
    personFk: foreignKey({
      name: 'people_assignments_tenant_person_fk',
      columns: [t.tenantId, t.personId],
      foreignColumns: [people.tenantId, people.id],
    }).onDelete('cascade'),
    orgFk: foreignKey({
      name: 'people_assignments_tenant_org_fk',
      columns: [t.tenantId, t.orgUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id],
    }).onDelete('cascade'),
  }),
)

export const orgUnitsRelations = relations(orgUnits, ({ one, many }) => ({
  tenant: one(tenants, { fields: [orgUnits.tenantId], references: [tenants.id] }),
  parent: one(orgUnits, {
    fields: [orgUnits.tenantId, orgUnits.parentId],
    references: [orgUnits.tenantId, orgUnits.id],
    relationName: 'orgUnitParent',
  }),
  children: many(orgUnits, { relationName: 'orgUnitParent' }),
}))

export const peopleRelations = relations(people, ({ one, many }) => ({
  tenant: one(tenants, { fields: [people.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [people.userId], references: [users.id] }),
  department: one(departments, {
    fields: [people.tenantId, people.departmentId],
    references: [departments.tenantId, departments.id],
  }),
  trade: one(trades, {
    fields: [people.tenantId, people.tradeId],
    references: [trades.tenantId, trades.id],
  }),
  crew: one(crews, {
    fields: [people.tenantId, people.crewId],
    references: [crews.tenantId, crews.id],
  }),
  manager: one(people, {
    fields: [people.tenantId, people.managerPersonId],
    references: [people.tenantId, people.id],
    relationName: 'manager',
  }),
  reports: many(people, { relationName: 'manager' }),
  assignments: many(peopleAssignments),
}))

export const peopleAssignmentsRelations = relations(peopleAssignments, ({ one }) => ({
  person: one(people, {
    fields: [peopleAssignments.tenantId, peopleAssignments.personId],
    references: [people.tenantId, people.id],
  }),
  orgUnit: one(orgUnits, {
    fields: [peopleAssignments.tenantId, peopleAssignments.orgUnitId],
    references: [orgUnits.tenantId, orgUnits.id],
  }),
}))
