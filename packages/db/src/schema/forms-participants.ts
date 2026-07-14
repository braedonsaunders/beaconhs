// Form response participants — the generic analog of the old toolbox attendee
// join-table, for ANY form. One row per (response, person) extracted when a
// response is submitted: top-level person pickers + repeating attendee sections
// (person_picker [+ signature]). Powers per-person transcripts and
// form-participation reports. Scheduled-form compliance uses the response's
// immutable submittedBy owner instead.
//
// Derived data: rebuilt (delete + reinsert) every time a response is submitted,
// so it is never soft-deleted.

import { relations } from 'drizzle-orm'
import {
  boolean,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants } from './core'
import { people } from './org'
import { formResponses, formTemplates } from './forms'

export const formResponseParticipants = pgTable(
  'form_response_participants',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    responseId: uuid('response_id').notNull(),
    templateId: uuid('template_id').notNull(),
    // Denormalized from form_templates.category at submit so transcript /
    // compliance / report queries can filter without a join.
    category: text('category'),
    personId: uuid('person_id').notNull(),
    // True when this participant's attendee row carried a signature.
    signed: boolean('signed').default(false).notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    // The response's primary date (first top-level date field), else submit date.
    occurredOn: date('occurred_on'),
    // Provenance: which field / repeating section the participant came from.
    fieldId: text('field_id'),
    sectionId: text('section_id'),
    role: text('role'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('form_response_participants_tenant_idx').on(t.tenantId),
    personIdx: index('form_response_participants_person_idx').on(t.tenantId, t.personId),
    responseIdx: index('form_response_participants_response_idx').on(
      t.tenantId,
      t.templateId,
      t.responseId,
    ),
    templateIdx: index('form_response_participants_template_idx').on(t.tenantId, t.templateId),
    responseFk: foreignKey({
      name: 'form_response_participants_tenant_template_response_fk',
      columns: [t.tenantId, t.templateId, t.responseId],
      foreignColumns: [formResponses.tenantId, formResponses.templateId, formResponses.id],
    }).onDelete('cascade'),
    templateFk: foreignKey({
      name: 'form_response_participants_tenant_template_fk',
      columns: [t.tenantId, t.templateId],
      foreignColumns: [formTemplates.tenantId, formTemplates.id],
    }).onDelete('cascade'),
    personFk: foreignKey({
      name: 'form_response_participants_tenant_person_fk',
      columns: [t.tenantId, t.personId],
      foreignColumns: [people.tenantId, people.id],
    }).onDelete('cascade'),
  }),
)

export const formResponseParticipantsRelations = relations(formResponseParticipants, ({ one }) => ({
  tenant: one(tenants, {
    fields: [formResponseParticipants.tenantId],
    references: [tenants.id],
  }),
  response: one(formResponses, {
    fields: [
      formResponseParticipants.tenantId,
      formResponseParticipants.templateId,
      formResponseParticipants.responseId,
    ],
    references: [formResponses.tenantId, formResponses.templateId, formResponses.id],
  }),
  template: one(formTemplates, {
    fields: [formResponseParticipants.tenantId, formResponseParticipants.templateId],
    references: [formTemplates.tenantId, formTemplates.id],
  }),
  person: one(people, {
    fields: [formResponseParticipants.tenantId, formResponseParticipants.personId],
    references: [people.tenantId, people.id],
  }),
}))
