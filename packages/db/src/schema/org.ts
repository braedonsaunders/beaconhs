// Org hierarchy + people. Hierarchy depth is tenant-configurable
// (customer / project / site / area) but always lives in one self-referential table.

import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  date,
  doublePrecision,
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
import { tenants, users } from './core'

export const orgUnitLevel = pgEnum('org_unit_level', ['customer', 'project', 'site', 'area'])

export const orgUnits = pgTable(
  'org_units',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): any => orgUnits.id, { onDelete: 'cascade' }),
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
    parentIdx: index('org_units_parent_idx').on(t.parentId),
    tenantLevelIdx: index('org_units_tenant_level_idx').on(t.tenantId, t.level),
    tenantCodeUx: uniqueIndex('org_units_tenant_code_ux').on(t.tenantId, t.code),
    metadataGin: index('org_units_metadata_gin').using('gin', t.metadata),
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
    tenantNameUx: uniqueIndex('departments_tenant_name_ux').on(t.tenantId, t.name),
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
    foremanPersonId: uuid('foreman_person_id'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('crews_tenant_idx').on(t.tenantId),
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
    jobTitle: text('job_title'),
    dateOfBirth: date('date_of_birth'),
    hireDate: date('hire_date'),
    terminationDate: date('termination_date'),
    departmentId: uuid('department_id').references(() => departments.id),
    tradeId: uuid('trade_id').references(() => trades.id),
    crewId: uuid('crew_id').references(() => crews.id),
    email: text('email'),
    phone: text('phone'),
    photoAttachmentId: uuid('photo_attachment_id'),
    // Self-referential reporting line. Nullable for top-level reports
    // (executives, contractors without a manager). The org-chart page builds
    // a tree from this column with a simple in-memory cycle guard.
    managerPersonId: uuid('manager_person_id').references((): any => people.id, {
      onDelete: 'set null',
    }),
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
  }),
)

export const peopleAssignments = pgTable(
  'people_assignments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    orgUnitId: uuid('org_unit_id')
      .notNull()
      .references(() => orgUnits.id, { onDelete: 'cascade' }),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('people_assignments_tenant_idx').on(t.tenantId),
    personIdx: index('people_assignments_person_idx').on(t.personId),
    orgIdx: index('people_assignments_org_idx').on(t.orgUnitId),
  }),
)

export const orgUnitsRelations = relations(orgUnits, ({ one, many }) => ({
  tenant: one(tenants, { fields: [orgUnits.tenantId], references: [tenants.id] }),
  parent: one(orgUnits, { fields: [orgUnits.parentId], references: [orgUnits.id] }),
  children: many(orgUnits),
}))

export const peopleRelations = relations(people, ({ one, many }) => ({
  tenant: one(tenants, { fields: [people.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [people.userId], references: [users.id] }),
  department: one(departments, { fields: [people.departmentId], references: [departments.id] }),
  trade: one(trades, { fields: [people.tradeId], references: [trades.id] }),
  crew: one(crews, { fields: [people.crewId], references: [crews.id] }),
  manager: one(people, {
    fields: [people.managerPersonId],
    references: [people.id],
    relationName: 'manager',
  }),
  reports: many(people, { relationName: 'manager' }),
  assignments: many(peopleAssignments),
}))
