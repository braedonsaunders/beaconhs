// Tenant-managed EMAIL TEMPLATES — the library the `send_email` flow action can
// pick from (mode='template'). Authored in the drag-and-drop builder
// (/admin/email-templates) which serializes a GrapesJS design + compiles MJML →
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
    subjectTemplate: text('subject_template').notNull().default(''), // supports {{tokens}}
    // GrapesJS getProjectData() — the builder doc, the authoritative reload format.
    design: jsonb('design').$type<Record<string, unknown>>().notNull().default({}),
    // Server-compiled MJML → responsive HTML, sanitized, {{tokens}} still embedded.
    compiledHtml: text('compiled_html').notNull().default(''),
    // Raw MJML source (editor.getHtml()) kept for re-compile / portability.
    mjmlSource: text('mjml_source'),
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
