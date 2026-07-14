// Tenant-managed EMAIL TEMPLATES — the library the `send_email` flow action can
// pick from (mode='template'). Authored in the HTML builder
// (/admin/email-templates), sanitized before persistence, and compiled to
// responsive HTML server-side. The compiled HTML carries {{merge}} tokens that
// are resolved per-send by @beaconhs/email-render.

import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { id, timestamps, softDelete } from './_helpers'
import { tenants, tenantUsers } from './core'

export const emailTemplateCategory = pgEnum('email_template_category', [
  'general',
  'notification',
  'reminder',
  'approval',
  'digest',
  'marketing',
])

// A merge token the builder palette can offer for this template.
export type EmailMergeField = { key: string; label: string; sample?: string }

export const emailTemplates = pgTable(
  'email_templates',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // Stable slug referenced by send_email.templateId-by-key (renaming the
    // display name never breaks a flow).
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    category: emailTemplateCategory('category').notNull().default('general'),
    // The record TYPE this template is written for: 'module' + a moduleKey
    // (journals, incidents, …) OR 'form_template' + a templateId (a Builder app).
    // Drives the merge-field palette (all that type's fields). Null ⇒ generic.
    recordSubjectType: text('record_subject_type'),
    recordSubjectKey: text('record_subject_key'),
    subjectTemplate: text('subject_template').notNull().default(''), // supports {{tokens}}
    // Server-compiled responsive HTML, sanitized, {{tokens}} still embedded.
    compiledHtml: text('compiled_html').notNull().default(''),
    // Sanitized editable HTML loaded by the builder and recompiled on save.
    sourceHtml: text('source_html'),
    mergeFields: jsonb('merge_fields').$type<EmailMergeField[]>().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    createdByTenantUserId: uuid('created_by_tenant_user_id').references(() => tenantUsers.id),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('email_templates_tenant_idx').on(t.tenantId),
    tenantKeyUx: uniqueIndex('email_templates_tenant_key_ux').on(t.tenantId, t.key),
    categoryIdx: index('email_templates_category_idx').on(t.tenantId, t.category),
  }),
)

export type EmailTemplate = typeof emailTemplates.$inferSelect
export type EmailTemplateInsert = typeof emailTemplates.$inferInsert

export const emailTemplatesRelations = relations(emailTemplates, ({ one }) => ({
  tenant: one(tenants, { fields: [emailTemplates.tenantId], references: [tenants.id] }),
}))
