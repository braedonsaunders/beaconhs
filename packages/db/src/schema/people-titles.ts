// Person titles — formal job-title catalogue. Distinct from
// `people.jobTitle` (which is a free-text label kept on the person row for
// back-compat). Mirrors the legacy `PEOPLEJOBTITLE` table — each title
// captures the structured "Job Description" PDF fields (scope,
// responsibilities, education, experience) plus drives the per-title task
// matrix that lives in `job-title-tasks.ts`.
//
// A person can hold multiple titles via `person_title_assignments`
// (e.g. an apprentice acting as a relief foreman), with `isPrimary` flagging
// the one we render on lists and PDFs.

import { relations } from 'drizzle-orm'
import { boolean, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants } from './core'
import { people } from './org'

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
    tenantNameUx: uniqueIndex('person_titles_tenant_name_ux').on(t.tenantId, t.name),
  }),
)

export const personTitleAssignments = pgTable(
  'person_title_assignments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    titleId: uuid('title_id')
      .notNull()
      .references(() => personTitles.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').default(false).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('person_title_assignments_tenant_idx').on(t.tenantId),
    titleIdx: index('person_title_assignments_title_idx').on(t.titleId),
    personIdx: index('person_title_assignments_person_idx').on(t.personId),
    uniqueAssignment: uniqueIndex('person_title_assignments_unique_ux').on(t.titleId, t.personId),
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
    fields: [personTitleAssignments.titleId],
    references: [personTitles.id],
  }),
  person: one(people, {
    fields: [personTitleAssignments.personId],
    references: [people.id],
  }),
}))
