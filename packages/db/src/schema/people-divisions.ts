// People divisions — hierarchical org axis orthogonal to the customer/site
// tree. Mirrors the legacy `PEOPLEDIVISION` table but adds a self-referential
// `parentDivisionId` so admins can model nested divisions (e.g.
// "Construction" → "Civil" → "Earthworks"). A person can belong to multiple
// divisions; the denormalised `divisionIds` cache lives on `people` for fast
// list-page filtering.
//
// Distinct from `org_units` (which represents physical/contract hierarchy)
// and `departments` (flat HR cost-centre code). Divisions are a soft business
// taxonomy that field supervisors use to slice training-matrix and
// compliance dashboards.

import { relations } from 'drizzle-orm'
import { index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants } from './core'
import { people } from './org'

export const personDivisions = pgTable(
  'person_divisions',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    parentDivisionId: uuid('parent_division_id').references(
      (): any => personDivisions.id,
      { onDelete: 'set null' },
    ),
    name: text('name').notNull(),
    description: text('description'),
    code: text('code'),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('person_divisions_tenant_idx').on(t.tenantId),
    parentIdx: index('person_divisions_parent_idx').on(t.parentDivisionId),
    tenantNameUx: uniqueIndex('person_divisions_tenant_name_ux').on(t.tenantId, t.name),
  }),
)

export const personDivisionMemberships = pgTable(
  'person_division_memberships',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    divisionId: uuid('division_id')
      .notNull()
      .references(() => personDivisions.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('person_division_memberships_tenant_idx').on(t.tenantId),
    divisionIdx: index('person_division_memberships_division_idx').on(t.divisionId),
    personIdx: index('person_division_memberships_person_idx').on(t.personId),
    uniqueMembership: uniqueIndex('person_division_memberships_unique_ux').on(
      t.divisionId,
      t.personId,
    ),
  }),
)

export const personDivisionsRelations = relations(personDivisions, ({ one, many }) => ({
  tenant: one(tenants, { fields: [personDivisions.tenantId], references: [tenants.id] }),
  parent: one(personDivisions, {
    fields: [personDivisions.parentDivisionId],
    references: [personDivisions.id],
  }),
  children: many(personDivisions),
  memberships: many(personDivisionMemberships),
}))

export const personDivisionMembershipsRelations = relations(
  personDivisionMemberships,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [personDivisionMemberships.tenantId],
      references: [tenants.id],
    }),
    division: one(personDivisions, {
      fields: [personDivisionMemberships.divisionId],
      references: [personDivisions.id],
    }),
    person: one(people, {
      fields: [personDivisionMemberships.personId],
      references: [people.id],
    }),
  }),
)
