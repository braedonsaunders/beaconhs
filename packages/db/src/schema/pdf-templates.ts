// Tenant-managed PDF DOCUMENT TEMPLATES — paper-size, paginated documents the
// flow `send_email` action can ATTACH (separate from email_templates, which are
// the email body). Authored in the same drag-and-drop builder but on a real page
// (Letter/A4 + margins), with a Paged.js pagination preview. The compiled HTML
// carries {{merge}} tokens + {{#each}} loops resolved per-render by
// @beaconhs/email-render; the worker prints it to PDF via Puppeteer @page CSS.

import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { id, timestamps, softDelete } from './_helpers'
import { tenants, tenantUsers } from './core'

export const pdfPaperSize = pgEnum('pdf_paper_size', ['letter', 'a4', 'legal'])
export const pdfOrientation = pgEnum('pdf_orientation', ['portrait', 'landscape'])

// A merge token the builder palette can offer for this template.
export type PdfMergeField = { key: string; label: string; sample?: string }

export const pdfTemplates = pgTable(
  'pdf_templates',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // Stable slug referenced by attach-pdf-by-key (renaming never breaks a flow).
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    // The record TYPE this document is written for (drives the merge-field +
    // collection palette). 'module' + moduleKey OR 'form_template' + templateId.
    recordSubjectType: text('record_subject_type'),
    recordSubjectKey: text('record_subject_key'),
    // --- page setup ---
    paperSize: pdfPaperSize('paper_size').notNull().default('letter'),
    orientation: pdfOrientation('orientation').notNull().default('portrait'),
    marginMm: integer('margin_mm').notNull().default(16),
    // Running header / footer HTML (supports {{tokens}}; {{page}} / {{pages}} for
    // page numbers). Rendered into the @page margin boxes.
    headerHtml: text('header_html'),
    footerHtml: text('footer_html'),
    // --- content ---
    // GrapesJS getProjectData() — the builder doc, the authoritative reload format.
    design: jsonb('design').$type<Record<string, unknown>>().notNull().default({}),
    // Server-compiled, sanitized HTML body, {{tokens}} / {{#each}} still embedded.
    compiledHtml: text('compiled_html').notNull().default(''),
    // The editable inline-styled HTML the builder canvas loads (data-each markers).
    sourceHtml: text('source_html'),
    mergeFields: jsonb('merge_fields').$type<PdfMergeField[]>().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    // When true, this template is the tenant's default for its module's built-in
    // print/PDF button (so the formatted record PDF uses the tenant's layout
    // instead of the hard-coded one). Only meaningful for recordSubjectType='module'.
    // At most one per (tenant, module) — enforced by moduleDefaultUx below.
    isModuleDefault: boolean('is_module_default').notNull().default(false),
    createdByTenantUserId: uuid('created_by_tenant_user_id').references(() => tenantUsers.id),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('pdf_templates_tenant_idx').on(t.tenantId),
    tenantKeyUx: uniqueIndex('pdf_templates_tenant_key_ux').on(t.tenantId, t.key),
    subjectIdx: index('pdf_templates_subject_idx').on(
      t.tenantId,
      t.recordSubjectType,
      t.recordSubjectKey,
    ),
    // At most one default print template per (tenant, module).
    moduleDefaultUx: uniqueIndex('pdf_templates_module_default_ux')
      .on(t.tenantId, t.recordSubjectKey)
      .where(
        sql`${t.isModuleDefault} and ${t.recordSubjectType} = 'module' and ${t.deletedAt} is null`,
      ),
  }),
)

export type PdfTemplate = typeof pdfTemplates.$inferSelect
export type PdfTemplateInsert = typeof pdfTemplates.$inferInsert

export const pdfTemplatesRelations = relations(pdfTemplates, ({ one }) => ({
  tenant: one(tenants, { fields: [pdfTemplates.tenantId], references: [tenants.id] }),
}))
