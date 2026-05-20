// Personal-file uploads attached to a person — resumes, certifications, ID
// copies, signed offer letters, etc. Distinct from `attachments` (the raw
// storage row) because we want a per-person index with a `kind` tag and
// human-friendly label, and we want CASCADE deletes when the person is purged
// (whereas the underlying attachment row stays put for audit trail and can be
// re-used by other entities).

import { relations } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants, users } from './core'
import { people } from './org'
import { attachments } from './attachments'

export const personFiles = pgTable(
  'person_files',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    attachmentId: uuid('attachment_id').references(() => attachments.id, {
      onDelete: 'set null',
    }),
    // Free-form display label e.g. "2024 forklift cert", "Drivers license".
    label: text('label').notNull(),
    // Bucket the file by intent — drives the badge colour on the per-person
    // list and lets us power "show me all resumes" lookups later.
    kind: text('kind').notNull(), // 'resume' | 'certification' | 'id_copy' | 'other'
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
    uploadedBy: text('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('person_files_tenant_idx').on(t.tenantId),
    personIdx: index('person_files_person_idx').on(t.personId),
    kindIdx: index('person_files_kind_idx').on(t.tenantId, t.kind),
  }),
)

export const personFilesRelations = relations(personFiles, ({ one }) => ({
  tenant: one(tenants, { fields: [personFiles.tenantId], references: [tenants.id] }),
  person: one(people, { fields: [personFiles.personId], references: [people.id] }),
  attachment: one(attachments, {
    fields: [personFiles.attachmentId],
    references: [attachments.id],
  }),
  uploader: one(users, { fields: [personFiles.uploadedBy], references: [users.id] }),
}))
