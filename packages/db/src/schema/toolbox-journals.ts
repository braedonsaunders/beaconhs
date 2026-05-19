// Toolbox Talks / Daily Journals — a first-class module separate from the
// canonical "Toolbox Talk" form template (which lives in canonical-templates).
//
// A journal is a single daily/weekly toolbox talk logged by a foreman or crew
// lead. Attendees sign in. Photos can be attached. Assignments dispatch on a
// cron schedule and drive compliance reporting per audience target.

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
import { orgUnits, people } from './org'

export const toolboxJournalStatus = pgEnum('toolbox_journal_status', [
  'draft',
  'submitted',
  'closed',
])

// --- toolbox_journals ------------------------------------------------------

export const toolboxJournals = pgTable(
  'toolbox_journals',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    reference: text('reference').notNull(), // e.g. TBX-2026-0001

    title: text('title').notNull(),
    topic: text('topic'),
    occurredOn: date('occurred_on').notNull(),

    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id),
    foremanTenantUserId: uuid('foreman_tenant_user_id').references(() => tenantUsers.id),

    discussionNotes: text('discussion_notes'),
    questionsRaised: text('questions_raised'),
    actionItems: text('action_items'),

    status: toolboxJournalStatus('status').default('draft').notNull(),
    locked: boolean('locked').default(false).notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),

    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('toolbox_journals_tenant_idx').on(t.tenantId),
    tenantReferenceUx: uniqueIndex('toolbox_journals_tenant_ref_ux').on(t.tenantId, t.reference),
    statusIdx: index('toolbox_journals_status_idx').on(t.tenantId, t.status),
    occurredIdx: index('toolbox_journals_occurred_idx').on(t.tenantId, t.occurredOn),
    siteIdx: index('toolbox_journals_site_idx').on(t.tenantId, t.siteOrgUnitId),
    foremanIdx: index('toolbox_journals_foreman_idx').on(t.tenantId, t.foremanTenantUserId),
  }),
)

// --- toolbox_journal_attendees --------------------------------------------
// Per-person sign-in. Person may sign (data URL) or not.

export const toolboxJournalAttendees = pgTable(
  'toolbox_journal_attendees',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    journalId: uuid('journal_id')
      .notNull()
      .references(() => toolboxJournals.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    signatureDataUrl: text('signature_data_url'),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('toolbox_journal_attendees_tenant_idx').on(t.tenantId),
    journalIdx: index('toolbox_journal_attendees_journal_idx').on(t.journalId),
    personIdx: index('toolbox_journal_attendees_person_idx').on(t.tenantId, t.personId),
    journalPersonUx: uniqueIndex('toolbox_journal_attendees_journal_person_ux').on(
      t.journalId,
      t.personId,
    ),
  }),
)

// --- toolbox_journal_photos ------------------------------------------------
// Linkage table — actual blob lives in `attachments`.

export const toolboxJournalPhotos = pgTable(
  'toolbox_journal_photos',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    journalId: uuid('journal_id')
      .notNull()
      .references(() => toolboxJournals.id, { onDelete: 'cascade' }),
    attachmentId: uuid('attachment_id').notNull(),
    caption: text('caption'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('toolbox_journal_photos_tenant_idx').on(t.tenantId),
    journalIdx: index('toolbox_journal_photos_journal_idx').on(t.journalId),
  }),
)

// --- toolbox_journal_assignments ------------------------------------------
// "Every Monday this foreman / role / site must log a toolbox talk."
// The audience is a flexible bag of role keys / personIds / orgUnitIds.

export type ToolboxAssignmentAudience = {
  roleKeys?: string[]
  personIds?: string[]
  orgUnitIds?: string[]
}

export const toolboxJournalAssignments = pgTable(
  'toolbox_journal_assignments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    audience: jsonb('audience')
      .$type<ToolboxAssignmentAudience>()
      .default({})
      .notNull(),
    cron: text('cron').notNull(), // e.g. '0 7 * * 1' (Monday 07:00)
    dueOffsetDays: integer('due_offset_days').default(0).notNull(),
    active: boolean('active').default(true).notNull(),
    compliantPercentage: integer('compliant_percentage').default(80).notNull(),
    createdByTenantUserId: uuid('created_by_tenant_user_id').references(() => tenantUsers.id),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('toolbox_journal_assignments_tenant_idx').on(t.tenantId),
    activeIdx: index('toolbox_journal_assignments_active_idx').on(t.tenantId, t.active),
  }),
)

// --- toolbox_journal_assignment_dispatches ---------------------------------
// Denormalised "fired at" log per assignment — used for compliance %.

export const toolboxJournalAssignmentDispatches = pgTable(
  'toolbox_journal_assignment_dispatches',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => toolboxJournalAssignments.id, { onDelete: 'cascade' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    dueOn: date('due_on'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('toolbox_journal_assignment_dispatches_tenant_idx').on(t.tenantId),
    assignmentIdx: index('toolbox_journal_assignment_dispatches_assignment_idx').on(t.assignmentId),
    occurredIdx: index('toolbox_journal_assignment_dispatches_occurred_idx').on(
      t.tenantId,
      t.occurredAt,
    ),
  }),
)

// --- Relations -------------------------------------------------------------

export const toolboxJournalsRelations = relations(toolboxJournals, ({ one, many }) => ({
  tenant: one(tenants, { fields: [toolboxJournals.tenantId], references: [tenants.id] }),
  site: one(orgUnits, { fields: [toolboxJournals.siteOrgUnitId], references: [orgUnits.id] }),
  foreman: one(tenantUsers, {
    fields: [toolboxJournals.foremanTenantUserId],
    references: [tenantUsers.id],
  }),
  attendees: many(toolboxJournalAttendees),
  photos: many(toolboxJournalPhotos),
}))

export const toolboxJournalAttendeesRelations = relations(
  toolboxJournalAttendees,
  ({ one }) => ({
    tenant: one(tenants, { fields: [toolboxJournalAttendees.tenantId], references: [tenants.id] }),
    journal: one(toolboxJournals, {
      fields: [toolboxJournalAttendees.journalId],
      references: [toolboxJournals.id],
    }),
    person: one(people, {
      fields: [toolboxJournalAttendees.personId],
      references: [people.id],
    }),
  }),
)

export const toolboxJournalPhotosRelations = relations(toolboxJournalPhotos, ({ one }) => ({
  tenant: one(tenants, { fields: [toolboxJournalPhotos.tenantId], references: [tenants.id] }),
  journal: one(toolboxJournals, {
    fields: [toolboxJournalPhotos.journalId],
    references: [toolboxJournals.id],
  }),
}))

export const toolboxJournalAssignmentsRelations = relations(
  toolboxJournalAssignments,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [toolboxJournalAssignments.tenantId],
      references: [tenants.id],
    }),
    dispatches: many(toolboxJournalAssignmentDispatches),
  }),
)

export const toolboxJournalAssignmentDispatchesRelations = relations(
  toolboxJournalAssignmentDispatches,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [toolboxJournalAssignmentDispatches.tenantId],
      references: [tenants.id],
    }),
    assignment: one(toolboxJournalAssignments, {
      fields: [toolboxJournalAssignmentDispatches.assignmentId],
      references: [toolboxJournalAssignments.id],
    }),
  }),
)
