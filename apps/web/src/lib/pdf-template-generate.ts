import 'server-only'

// Create a Builder app's default PDF DOCUMENT template from its published
// schema — the per-app equivalent of the seeded native-module documents.
// The document itself comes from @beaconhs/forms-core's generateFormPdfTemplate
// (the same generator the dev-seed backfill uses); this wrapper compiles it
// through the builder pipeline (expand tr markers → sanitize) and inserts the
// pdf_templates row. Called from:
//   • the form-template PUBLISH action (first publish generates the document),
//   • the /admin/pdf-templates "Generate" affordance for apps lacking one.
// It NEVER overwrites: any existing template for the app (a tenant edit) wins.

import { and, desc, eq, isNull } from 'drizzle-orm'
import { formTemplateVersions, formTemplates, pdfTemplates } from '@beaconhs/db/schema'
import { generateFormPdfTemplate, type FormSchemaV1 } from '@beaconhs/forms-core'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'
import { compileBuilderHtml } from '@/lib/template-builder-compile'

type EnsureFormPdfTemplateResult = {
  /** True when this call created the template. */
  created: boolean
  /** The app's active template id (existing or new); null when none exists. */
  templateId: string | null
}

/**
 * Ensure the form template has a PDF document template, generating one when it
 * has none. With `respectDeleted` (the publish hook), a soft-deleted template
 * counts as "the tenant removed it on purpose" and nothing is created; the
 * explicit admin Generate button passes false to build a fresh one.
 */
export async function ensureFormPdfTemplate(
  ctx: RequestContext,
  formTemplateId: string,
  opts: { respectDeleted?: boolean } = {},
): Promise<EnsureFormPdfTemplateResult> {
  const respectDeleted = opts.respectDeleted ?? true
  if (!ctx.tenantId) return { created: false, templateId: null }

  const existing = await ctx.db((tx) =>
    tx
      .select({ id: pdfTemplates.id, deletedAt: pdfTemplates.deletedAt })
      .from(pdfTemplates)
      .where(
        and(
          eq(pdfTemplates.recordSubjectType, 'form_template'),
          eq(pdfTemplates.recordSubjectKey, formTemplateId),
        ),
      ),
  )
  const active = existing.find((t) => !t.deletedAt)
  if (active) return { created: false, templateId: active.id }
  if (existing.length > 0 && respectDeleted) return { created: false, templateId: null }

  const [form] = await ctx.db((tx) =>
    tx
      .select({ id: formTemplates.id, key: formTemplates.key, name: formTemplates.name })
      .from(formTemplates)
      .where(and(eq(formTemplates.id, formTemplateId), isNull(formTemplates.deletedAt)))
      .limit(1),
  )
  if (!form) return { created: false, templateId: null }

  const [ver] = await ctx.db((tx) =>
    tx
      .select({ schema: formTemplateVersions.schema })
      .from(formTemplateVersions)
      .where(eq(formTemplateVersions.templateId, formTemplateId))
      .orderBy(desc(formTemplateVersions.version))
      .limit(1),
  )
  const schema = ver?.schema as FormSchemaV1 | undefined
  if (!schema) return { created: false, templateId: null }

  const gen = generateFormPdfTemplate(schema, form.name)
  const compiled = compileBuilderHtml(gen.sourceHtml)

  const newId = await ctx.db(async (tx) => {
    // The (tenant, key) unique index covers soft-deleted rows too — probe all.
    const taken = new Set(
      (await tx.select({ key: pdfTemplates.key }).from(pdfTemplates)).map((r) => r.key),
    )
    let key = `form-${form.key}-pdf`
    for (let n = 2; taken.has(key); n++) key = `form-${form.key}-pdf-${n}`

    const [row] = await tx
      .insert(pdfTemplates)
      .values({
        tenantId: ctx.tenantId,
        key,
        name: `${form.name} PDF`,
        recordSubjectType: 'form_template',
        recordSubjectKey: formTemplateId,
        paperSize: 'letter',
        orientation: 'portrait',
        marginMm: 14,
        headerHtml: gen.headerHtml,
        footerHtml: gen.footerHtml,
        sourceHtml: gen.sourceHtml,
        compiledHtml: compiled.html,
        // No active template exists for the subject, so this one is the
        // app's response-PDF default (partial unique index enforces one).
        isModuleDefault: true,
        createdByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning({ id: pdfTemplates.id })
    return row?.id ?? null
  })
  if (!newId) return { created: false, templateId: null }

  await recordAudit(ctx, {
    entityType: 'pdf_template',
    entityId: newId,
    action: 'create',
    summary: `Generated default PDF template for app "${form.name}"`,
  })
  return { created: true, templateId: newId }
}
