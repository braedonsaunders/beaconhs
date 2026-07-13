import 'server-only'

// Shared helpers for the PDF document-template library (paper-size builder).
// Parallels lib/email-templates.ts but for `pdf_templates` (attached by the
// send_email flow action, NOT the email body). Reuses the same builder-HTML
// compile (expand data-each markers → {{#each}}, then sanitize).

import { and, asc, desc, eq, isNull, or } from 'drizzle-orm'
import { formResponses, pdfTemplates, type PdfTemplate } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'

export async function loadTenantPdfTemplate(
  ctx: RequestContext,
  id: string,
): Promise<PdfTemplate | null> {
  const [t] = await ctx.db((tx) =>
    tx
      .select()
      .from(pdfTemplates)
      .where(and(eq(pdfTemplates.id, id), isNull(pdfTemplates.deletedAt)))
      .limit(1),
  )
  return t ?? null
}

// The columns a render needs: merged by renderTemplate, printed as template_pdf.
export type PdfTemplateRenderConfig = {
  id: string
  compiledHtml: string
  paperSize: 'letter' | 'a4' | 'legal'
  orientation: 'portrait' | 'landscape'
  marginMm: number
  headerHtml: string | null
  footerHtml: string | null
}

const PDF_RENDER_COLS = {
  id: pdfTemplates.id,
  compiledHtml: pdfTemplates.compiledHtml,
  paperSize: pdfTemplates.paperSize,
  orientation: pdfTemplates.orientation,
  marginMm: pdfTemplates.marginMm,
  headerHtml: pdfTemplates.headerHtml,
  footerHtml: pdfTemplates.footerHtml,
} as const

/**
 * The tenant's default print template for a native module — the template
 * flagged as default for (recordSubjectType='module', recordSubjectKey=moduleKey).
 * Null ⇒ the module's record PDFs use the generic record summary.
 */
export async function getModuleDefaultTemplate(
  ctx: RequestContext,
  moduleKey: string,
): Promise<PdfTemplateRenderConfig | null> {
  const [t] = await ctx.db((tx) =>
    tx
      .select(PDF_RENDER_COLS)
      .from(pdfTemplates)
      .where(
        and(
          isNull(pdfTemplates.deletedAt),
          eq(pdfTemplates.isActive, true),
          eq(pdfTemplates.isModuleDefault, true),
          eq(pdfTemplates.recordSubjectType, 'module'),
          eq(pdfTemplates.recordSubjectKey, moduleKey),
        ),
      )
      .limit(1),
  )
  return t ?? null
}

/**
 * A form template's OWN PDF template (recordSubjectType='form_template',
 * recordSubjectKey=<formTemplateId>). Any active template for the form counts;
 * one flagged as default wins, ties broken deterministically by name.
 */
export async function getFormTemplateDefaultTemplate(
  ctx: RequestContext,
  formTemplateId: string,
): Promise<PdfTemplateRenderConfig | null> {
  const [t] = await ctx.db((tx) =>
    tx
      .select(PDF_RENDER_COLS)
      .from(pdfTemplates)
      .where(
        and(
          isNull(pdfTemplates.deletedAt),
          eq(pdfTemplates.isActive, true),
          eq(pdfTemplates.recordSubjectType, 'form_template'),
          eq(pdfTemplates.recordSubjectKey, formTemplateId),
        ),
      )
      .orderBy(desc(pdfTemplates.isModuleDefault), asc(pdfTemplates.name), asc(pdfTemplates.id))
      .limit(1),
  )
  return t ?? null
}

/**
 * Resolve the default PDF template for ANY flow subject: a module's flagged
 * default, or — for form-template subjects — the form's own template. The form
 * adapter carries subjectKey=null, so the response's templateId is looked up
 * from subjectId (the responseId) when needed.
 */
export async function resolveSubjectDefaultPdfTemplate(
  ctx: RequestContext,
  subject: {
    subjectType: 'form_template' | 'module'
    subjectKey: string | null
    subjectId: string
  },
): Promise<PdfTemplateRenderConfig | null> {
  if (subject.subjectType === 'module') {
    return subject.subjectKey ? getModuleDefaultTemplate(ctx, subject.subjectKey) : null
  }
  let templateId = subject.subjectKey
  if (!templateId) {
    const [r] = await ctx.db((tx) =>
      tx
        .select({ templateId: formResponses.templateId })
        .from(formResponses)
        .where(eq(formResponses.id, subject.subjectId))
        .limit(1),
    )
    templateId = r?.templateId ?? null
  }
  return templateId ? getFormTemplateDefaultTemplate(ctx, templateId) : null
}

type PdfTemplateOption = {
  id: string
  name: string
  key: string
  recordSubjectType: string | null
  recordSubjectKey: string | null
}

const PDF_OPTION_COLS = {
  id: pdfTemplates.id,
  name: pdfTemplates.name,
  key: pdfTemplates.key,
  recordSubjectType: pdfTemplates.recordSubjectType,
  recordSubjectKey: pdfTemplates.recordSubjectKey,
} as const

/** Active PDF templates relevant to a flow's subject (typed for it, or generic). */
export async function listActivePdfTemplatesForSubject(
  ctx: RequestContext,
  subjectType: string,
  subjectKey: string,
): Promise<PdfTemplateOption[]> {
  return ctx.db((tx) =>
    tx
      .select(PDF_OPTION_COLS)
      .from(pdfTemplates)
      .where(
        and(
          isNull(pdfTemplates.deletedAt),
          eq(pdfTemplates.isActive, true),
          or(
            isNull(pdfTemplates.recordSubjectType),
            and(
              eq(pdfTemplates.recordSubjectType, subjectType),
              eq(pdfTemplates.recordSubjectKey, subjectKey),
            ),
          ),
        ),
      )
      .orderBy(asc(pdfTemplates.name)),
  )
}
