// Daily Journals — an individual worker's / supervisor's daily field-safety log.
//
// Distinct from the crew "Toolbox Talks" module (toolbox-journals.ts), which is
// a group meeting with attendee sign-in. A journal entry is one person's dated
// log: rich text + photos, tied to a job site, AI-tagged for rediscovery.
//
// Assignments dispatch a required cadence (e.g. "every worker logs daily") and
// drive flat per-period compliance reporting per audience target.

import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  customType,
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

// Postgres full-text search vector. Maintained as a STORED generated column so
// it stays in lock-step with title/body/summary without trigger plumbing.
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector'
  },
})

export const journalEntryStatus = pgEnum('journal_entry_status', ['draft', 'submitted', 'archived'])

// Mirrors the legacy "Definition" field (Worker vs Supervisor log).
export const journalDefinition = pgEnum('journal_definition', ['worker', 'supervisor'])

export const journalTagSource = pgEnum('journal_tag_source', ['ai', 'user'])

export const journalAssignmentFrequency = pgEnum('journal_assignment_frequency', [
  'day',
  'week',
  'month',
  'quarter',
  'year',
])

// --- journal_entries -------------------------------------------------------

export type JournalWeather = {
  tempC?: number
  conditions?: string
  icon?: string
}

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    reference: text('reference').notNull(), // e.g. JRN-2026-0001

    // The subject of the log (whose day this is). Nullable on a fresh draft
    // until resolved from the author's `people` row.
    personId: uuid('person_id').references(() => people.id),
    supervisorPersonId: uuid('supervisor_person_id').references(() => people.id),
    // Who actually typed it (always set — the tenant_user behind the request).
    createdByTenantUserId: uuid('created_by_tenant_user_id').references(() => tenantUsers.id),

    entryDate: date('entry_date').notNull(),
    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id),
    definition: journalDefinition('definition').default('worker').notNull(),

    title: text('title'),
    bodyHtml: text('body_html'), // TipTap HTML
    bodyText: text('body_text'), // plaintext mirror — powers search + AI
    summary: text('summary'), // AI one-paragraph recap

    status: journalEntryStatus('status').default('draft').notNull(),

    weather: jsonb('weather').$type<JournalWeather | null>(),
    geo: jsonb('geo').$type<{ lat?: number; lng?: number } | null>(),

    // Denormalised tag cache for quick chips/filter (source of truth is
    // journal_entry_tags). Rewritten whenever tags change — mirrors the
    // people.groupIds pattern.
    tagsCache: jsonb('tags_cache').$type<string[]>().default([]).notNull(),

    aiMeta: jsonb('ai_meta').$type<Record<string, unknown>>().default({}).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),

    // Generated full-text vector over title + body + summary. Uses the 2-arg
    // (immutable) to_tsvector form so it's legal in a generated column.
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body_text, '') || ' ' || coalesce(summary, ''))`,
    ),

    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('journal_entries_tenant_idx').on(t.tenantId),
    tenantReferenceUx: uniqueIndex('journal_entries_tenant_ref_ux').on(t.tenantId, t.reference),
    dateIdx: index('journal_entries_date_idx').on(t.tenantId, t.entryDate),
    personDateIdx: index('journal_entries_person_date_idx').on(t.tenantId, t.personId, t.entryDate),
    siteIdx: index('journal_entries_site_idx').on(t.tenantId, t.siteOrgUnitId),
    statusIdx: index('journal_entries_status_idx').on(t.tenantId, t.status),
    searchIdx: index('journal_entries_search_idx').using('gin', t.searchVector),
  }),
)

// --- journal_entry_photos --------------------------------------------------
// Linkage table — the actual blob lives in `attachments`.

export const journalEntryPhotos = pgTable(
  'journal_entry_photos',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'cascade' }),
    attachmentId: uuid('attachment_id').notNull(),
    caption: text('caption'), // user or AI caption
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('journal_entry_photos_tenant_idx').on(t.tenantId),
    entryIdx: index('journal_entry_photos_entry_idx').on(t.entryId),
  }),
)

// --- journal_entry_tags ----------------------------------------------------
// Normalised tags — power the "group by topic" tree + tag filters.

export const journalEntryTags = pgTable(
  'journal_entry_tags',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
    source: journalTagSource('source').default('ai').notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantTagIdx: index('journal_entry_tags_tenant_tag_idx').on(t.tenantId, t.tag),
    entryIdx: index('journal_entry_tags_entry_idx').on(t.entryId),
    entryTagUx: uniqueIndex('journal_entry_tags_entry_tag_ux').on(t.entryId, t.tag),
  }),
)

// --- journal_tags ----------------------------------------------------------
// Tenant-curated tag vocabulary. The source of truth for which tags an ENTRY
// carries is still journal_entry_tags; this table lets admins govern the
// vocabulary itself — attach a colour + description, and (via server actions
// that rewrite journal_entry_tags + the tagsCache) rename / merge / delete.
// A tag may exist in entries with no row here (ad-hoc); a row here may have
// zero usage (pre-defined, still offered in the picker).

export const journalTags = pgTable(
  'journal_tags',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(), // canonical, lower-cased
    color: text('color'), // palette key (e.g. 'teal') — null = default
    description: text('description'),
    createdByTenantUserId: uuid('created_by_tenant_user_id').references(() => tenantUsers.id),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('journal_tags_tenant_idx').on(t.tenantId),
    tenantNameUx: uniqueIndex('journal_tags_tenant_name_ux').on(t.tenantId, t.name),
  }),
)

// --- journal_assignments ---------------------------------------------------
// "Every worker / this role / this site must log N entries per <frequency>."

export type JournalAssignmentAudience = {
  roleKeys?: string[]
  personIds?: string[]
  orgUnitIds?: string[]
}

export const journalAssignments = pgTable(
  'journal_assignments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    audience: jsonb('audience').$type<JournalAssignmentAudience>().default({}).notNull(),
    frequency: journalAssignmentFrequency('frequency').default('week').notNull(),
    quantity: integer('quantity').default(1).notNull(), // entries required per period
    dueOffsetDays: integer('due_offset_days').default(0).notNull(),
    active: boolean('active').default(true).notNull(),
    compliantPercentage: integer('compliant_percentage').default(100).notNull(),
    // Extra recipients on submit (legacy SendToAdditional parity).
    sendToAdditional: jsonb('send_to_additional')
      .$type<{ personIds?: string[]; emails?: string[] }>()
      .default({})
      .notNull(),
    cron: text('cron'), // optional reminder dispatch schedule
    createdByTenantUserId: uuid('created_by_tenant_user_id').references(() => tenantUsers.id),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('journal_assignments_tenant_idx').on(t.tenantId),
    activeIdx: index('journal_assignments_active_idx').on(t.tenantId, t.active),
  }),
)

// --- journal_assignment_dispatches -----------------------------------------
// Denormalised "fired at" log per assignment — used for compliance windows.

export const journalAssignmentDispatches = pgTable(
  'journal_assignment_dispatches',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => journalAssignments.id, { onDelete: 'cascade' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    dueOn: date('due_on'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('journal_assignment_dispatches_tenant_idx').on(t.tenantId),
    assignmentIdx: index('journal_assignment_dispatches_assignment_idx').on(t.assignmentId),
    occurredIdx: index('journal_assignment_dispatches_occurred_idx').on(t.tenantId, t.occurredAt),
  }),
)

// --- Relations -------------------------------------------------------------

export const journalEntriesRelations = relations(journalEntries, ({ one, many }) => ({
  tenant: one(tenants, { fields: [journalEntries.tenantId], references: [tenants.id] }),
  person: one(people, {
    fields: [journalEntries.personId],
    references: [people.id],
    relationName: 'journalAuthor',
  }),
  supervisor: one(people, {
    fields: [journalEntries.supervisorPersonId],
    references: [people.id],
    relationName: 'journalSupervisor',
  }),
  site: one(orgUnits, { fields: [journalEntries.siteOrgUnitId], references: [orgUnits.id] }),
  createdBy: one(tenantUsers, {
    fields: [journalEntries.createdByTenantUserId],
    references: [tenantUsers.id],
  }),
  photos: many(journalEntryPhotos),
  tags: many(journalEntryTags),
}))

export const journalEntryPhotosRelations = relations(journalEntryPhotos, ({ one }) => ({
  tenant: one(tenants, { fields: [journalEntryPhotos.tenantId], references: [tenants.id] }),
  entry: one(journalEntries, {
    fields: [journalEntryPhotos.entryId],
    references: [journalEntries.id],
  }),
}))

export const journalEntryTagsRelations = relations(journalEntryTags, ({ one }) => ({
  tenant: one(tenants, { fields: [journalEntryTags.tenantId], references: [tenants.id] }),
  entry: one(journalEntries, {
    fields: [journalEntryTags.entryId],
    references: [journalEntries.id],
  }),
}))

export const journalTagsRelations = relations(journalTags, ({ one }) => ({
  tenant: one(tenants, { fields: [journalTags.tenantId], references: [tenants.id] }),
}))

export const journalAssignmentsRelations = relations(journalAssignments, ({ one, many }) => ({
  tenant: one(tenants, { fields: [journalAssignments.tenantId], references: [tenants.id] }),
  dispatches: many(journalAssignmentDispatches),
}))

export const journalAssignmentDispatchesRelations = relations(
  journalAssignmentDispatches,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [journalAssignmentDispatches.tenantId],
      references: [tenants.id],
    }),
    assignment: one(journalAssignments, {
      fields: [journalAssignmentDispatches.assignmentId],
      references: [journalAssignments.id],
    }),
  }),
)
