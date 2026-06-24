import 'server-only'

// Shared helpers for the PDF document-template library (paper-size builder).
// Parallels lib/email-templates.ts but for `pdf_templates` (attached by the
// send_email flow action, NOT the email body). Reuses the same builder-HTML
// compile (expand data-each markers → {{#each}}, then sanitize).

import { and, asc, eq, isNull, or } from 'drizzle-orm'
import { pdfTemplates, type PdfTemplate } from '@beaconhs/db/schema'
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

export type PdfTemplateOption = {
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

export async function listActivePdfTemplates(ctx: RequestContext): Promise<PdfTemplateOption[]> {
  return ctx.db((tx) =>
    tx
      .select(PDF_OPTION_COLS)
      .from(pdfTemplates)
      .where(and(isNull(pdfTemplates.deletedAt), eq(pdfTemplates.isActive, true)))
      .orderBy(asc(pdfTemplates.name)),
  )
}

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
