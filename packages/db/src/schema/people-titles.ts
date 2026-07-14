// Person titles — the single canonical job-title catalogue. Mirrors the legacy
// `PEOPLEJOBTITLE` table: each title captures the structured "Job Description"
// PDF fields (scope, responsibilities, education, experience) and drives the
// per-title task matrix in `job-title-tasks.ts`.
//
// A person can hold multiple titles via `person_title_assignments`
// (e.g. an apprentice acting as a relief foreman), with `isPrimary` flagging
// the one we render on lists and PDFs.

import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { catalogNameIsNonblankSql, normalizedCatalogNameSql } from '../catalog-name'
import { tenants } from './core'
import { people } from './org'
import { syncConnections } from './sync'

export const personTitles = pgTable(
  'person_titles',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'), // legacy "Scope"
    responsibilities: text('responsibilities'),
    education: text('education'),
    experience: text('experience'),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('person_titles_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('person_titles_tenant_id_id_ux').on(t.tenantId, t.id),
    tenantNormalizedNameUx: uniqueIndex('person_titles_tenant_normalized_name_ux').on(
      t.tenantId,
      normalizedCatalogNameSql(t.name),
    ),
    nameNonblank: check('person_titles_name_nonblank_ck', catalogNameIsNonblankSql(t.name)),
  }),
)

export const personTitleAssignments = pgTable(
  'person_title_assignments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    titleId: uuid('title_id').notNull(),
    personId: uuid('person_id').notNull(),
    isPrimary: boolean('is_primary').default(false).notNull(),
    // A synced title can also have been selected manually before the source
    // claimed it. Keep both facts so removing/changing the source never erases
    // a legitimate manual assignment that happens to have the same title.
    sourceConnectionId: uuid('source_connection_id'),
    isManuallyMaintained: boolean('is_manually_maintained').default(true).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('person_title_assignments_tenant_idx').on(t.tenantId),
    titleIdx: index('person_title_assignments_title_idx').on(t.tenantId, t.titleId),
    personIdx: index('person_title_assignments_person_idx').on(t.tenantId, t.personId),
    sourceConnectionIdx: index('person_title_assignments_source_connection_idx').on(
      t.tenantId,
      t.sourceConnectionId,
    ),
    uniqueAssignment: uniqueIndex('person_title_assignments_unique_ux').on(
      t.tenantId,
      t.titleId,
      t.personId,
    ),
    // A person may hold several titles, but list/search/PDF surfaces need one
    // deterministic primary title. The action layer maintains this invariant;
    // the partial index prevents imports, races, or ad-hoc writes from creating
    // two primaries for the same person.
    onePrimaryPerPerson: uniqueIndex('person_title_assignments_one_primary_ux')
      .on(t.tenantId, t.personId)
      .where(sql`${t.isPrimary} = true`),
    // A people connection exposes one canonical job title per person. Keeping
    // that ownership one-to-one makes source changes and blank values
    // deterministic while manual secondary assignments remain independent.
    oneSourceTitlePerPerson: uniqueIndex('person_title_assignments_source_owner_ux')
      .on(t.tenantId, t.personId, t.sourceConnectionId)
      .where(sql`${t.sourceConnectionId} is not null`),
    titleFk: foreignKey({
      name: 'person_title_assignments_tenant_title_fk',
      columns: [t.tenantId, t.titleId],
      foreignColumns: [personTitles.tenantId, personTitles.id],
    }).onDelete('cascade'),
    personFk: foreignKey({
      name: 'person_title_assignments_tenant_person_fk',
      columns: [t.tenantId, t.personId],
      foreignColumns: [people.tenantId, people.id],
    }).onDelete('cascade'),
    sourceConnectionFk: foreignKey({
      name: 'person_title_assignments_tenant_source_connection_fk',
      columns: [t.tenantId, t.sourceConnectionId],
      foreignColumns: [syncConnections.tenantId, syncConnections.id],
    }),
    hasOwner: check(
      'person_title_assignments_has_owner_ck',
      sql`${t.sourceConnectionId} is not null or ${t.isManuallyMaintained} = true`,
    ),
    sourceIsPrimary: check(
      'person_title_assignments_source_primary_ck',
      sql`${t.sourceConnectionId} is null or ${t.isPrimary} = true`,
    ),
  }),
)

export const personTitlesRelations = relations(personTitles, ({ one, many }) => ({
  tenant: one(tenants, { fields: [personTitles.tenantId], references: [tenants.id] }),
  assignments: many(personTitleAssignments),
}))

export const personTitleAssignmentsRelations = relations(personTitleAssignments, ({ one }) => ({
  tenant: one(tenants, {
    fields: [personTitleAssignments.tenantId],
    references: [tenants.id],
  }),
  title: one(personTitles, {
    fields: [personTitleAssignments.tenantId, personTitleAssignments.titleId],
    references: [personTitles.tenantId, personTitles.id],
  }),
  person: one(people, {
    fields: [personTitleAssignments.tenantId, personTitleAssignments.personId],
    references: [people.tenantId, people.id],
  }),
  sourceConnection: one(syncConnections, {
    fields: [personTitleAssignments.tenantId, personTitleAssignments.sourceConnectionId],
    references: [syncConnections.tenantId, syncConnections.id],
  }),
}))
