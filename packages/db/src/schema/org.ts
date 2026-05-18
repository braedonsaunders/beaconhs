// Org hierarchy + people. Hierarchy depth is tenant-configurable
// (customer / project / site / area) but always lives in one self-referential table.

import { relations } from 'drizzle-orm'
import {
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
import { tenants, tenantUsers, users } from './core'

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
    address: jsonb('address').$type<{ line1?: string; line2?: string; city?: string; region?: string; postal?: string; country?: string }>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('org_units_tenant_idx').on(t.tenantId),
    parentIdx: index('org_units_parent_idx').on(t.parentId),
    tenantLevelIdx: index('org_units_tenant_level_idx').on(t.tenantId, t.level),
    tenantCodeUx: uniqueIndex('org_units_tenant_code_ux').on(t.tenantId, t.code),
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
    userId: uuid('user_id').references(() => users.id),
    employeeNo: text('employee_no'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    dateOfBirth: date('date_of_birth'),
    hireDate: date('hire_date'),
    terminationDate: date('termination_date'),
    departmentId: uuid('department_id').references(() => departments.id),
    tradeId: uuid('trade_id').references(() => trades.id),
    crewId: uuid('crew_id').references(() => crews.id),
    email: text('email'),
    phone: text('phone'),
    photoAttachmentId: uuid('photo_attachment_id'),
    status: peopleStatus('status').default('active').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('people_tenant_idx').on(t.tenantId),
    tenantEmployeeNoUx: uniqueIndex('people_tenant_employee_no_ux').on(t.tenantId, t.employeeNo),
    nameIdx: index('people_name_idx').on(t.tenantId, t.lastName, t.firstName),
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
  assignments: many(peopleAssignments),
}))
