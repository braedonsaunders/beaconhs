// People groups — flat, colourful pivot tag that any person can belong to.
//
// Mirrors the legacy `PEOPLEGROUP` + `PEOPLEGROUPRECORD` pair. Used for
// arbitrary groupings beyond crew/department/trade (e.g. "First Aid
// Responders", "Confined-Space Entrants", "JHSC Members"). One person can
// belong to many groups. The denormalised `groupIds` cache lives on
// `people` so list pages can filter by group without an extra join.
//
// Visual styling: `color` is a hex string the UI uses to render the group
// chip — handy for distinguishing emergency-response groups from cosmetic
// taxonomies.

import { relations } from 'drizzle-orm'
import { check, foreignKey, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { catalogNameIsNonblankSql, normalizedCatalogNameSql } from '../catalog-name'
import { tenants } from './core'
import { people } from './org'

export const personGroups = pgTable(
  'person_groups',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color'), // hex like '#0f766e'
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('person_groups_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('person_groups_tenant_id_id_ux').on(t.tenantId, t.id),
    tenantNormalizedNameUx: uniqueIndex('person_groups_tenant_normalized_name_ux').on(
      t.tenantId,
      normalizedCatalogNameSql(t.name),
    ),
    nameNonblank: check('person_groups_name_nonblank_ck', catalogNameIsNonblankSql(t.name)),
  }),
)

export const personGroupMemberships = pgTable(
  'person_group_memberships',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').notNull(),
    personId: uuid('person_id').notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('person_group_memberships_tenant_idx').on(t.tenantId),
    groupIdx: index('person_group_memberships_group_idx').on(t.tenantId, t.groupId),
    personIdx: index('person_group_memberships_person_idx').on(t.tenantId, t.personId),
    uniqueMembership: uniqueIndex('person_group_memberships_unique_ux').on(
      t.tenantId,
      t.groupId,
      t.personId,
    ),
    groupFk: foreignKey({
      name: 'person_group_memberships_tenant_group_fk',
      columns: [t.tenantId, t.groupId],
      foreignColumns: [personGroups.tenantId, personGroups.id],
    }).onDelete('cascade'),
    personFk: foreignKey({
      name: 'person_group_memberships_tenant_person_fk',
      columns: [t.tenantId, t.personId],
      foreignColumns: [people.tenantId, people.id],
    }).onDelete('cascade'),
  }),
)

export const personGroupsRelations = relations(personGroups, ({ one, many }) => ({
  tenant: one(tenants, { fields: [personGroups.tenantId], references: [tenants.id] }),
  memberships: many(personGroupMemberships),
}))

export const personGroupMembershipsRelations = relations(personGroupMemberships, ({ one }) => ({
  tenant: one(tenants, {
    fields: [personGroupMemberships.tenantId],
    references: [tenants.id],
  }),
  group: one(personGroups, {
    fields: [personGroupMemberships.tenantId, personGroupMemberships.groupId],
    references: [personGroups.tenantId, personGroups.id],
  }),
  person: one(people, {
    fields: [personGroupMemberships.tenantId, personGroupMemberships.personId],
    references: [people.tenantId, people.id],
  }),
}))
