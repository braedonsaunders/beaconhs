import 'server-only'

// Record PDFs — ONE resolution chain for every subject:
//
//   1. The record's assigned PDF DOCUMENT template (/admin/pdf-templates):
//      the per-module default (`pdf_templates.is_module_default`) for native
//      modules, or the form template's OWN template for Builder apps.
//   2. The generic record-summary PDF built from the same adapter values.
//
// The merge + render reuses the exact chain the flows engine already uses:
// buildFlowAdapter(...).loadValues() → renderTemplate → template_pdf.

import { and, asc, eq, isNull } from 'drizzle-orm'
import { formResponses, formTemplates, pdfTemplates } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { renderTemplate } from '@beaconhs/email-render'
import type { OnDemandPdfJobData } from '@beaconhs/jobs'
import { buildFlowAdapter } from '@/lib/flows/registry'
import { buildRecordSummaryPdfJob } from '@/lib/flows/pdf-summary'
import {
  getFormTemplateDefaultTemplate,
  getModuleDefaultTemplate,
  type PdfTemplateRenderConfig,
} from '@/lib/pdf-templates'
import { renderOnDemandPdfResponse } from '@/lib/pdf-route'

// Modules whose record PDFs can be driven by a tenant template. Each has a
// registered flow adapter (loadValues + the record-summary fallback) AND a
// /…/pdf route wired through renderModulePdfResponse below. Documents are
// excluded — they're hand-authored, so the document *is* the content.
export const MODULE_PDF_TARGETS: { moduleKey: string; label: string }[] = [
  { moduleKey: 'incidents', label: 'Incidents' },
  { moduleKey: 'hazid', label: 'Hazard assessments' },
  { moduleKey: 'corrective-actions', label: 'Corrective actions' },
  { moduleKey: 'equipment', label: 'Equipment work orders' },
  { moduleKey: 'ppe-issues', label: 'PPE issue reports' },
  { moduleKey: 'journals', label: 'Journals' },
  { moduleKey: 'inspections', label: 'Inspections' },
  { moduleKey: 'vehicle-log', label: 'Vehicle log (monthly sheet)' },
]

export function isModulePdfTarget(moduleKey: string): boolean {
  return MODULE_PDF_TARGETS.some((t) => t.moduleKey === moduleKey)
}

// Merge a template with a record's values and print it via template_pdf.
function templatePdfResponse(
  ctx: RequestContext,
  tpl: PdfTemplateRenderConfig,
  args: { values: Record<string, unknown>; entityType: string; entityId: string; filename: string },
): Promise<Response> {
  const headerVals = { ...args.values, page: '{{page}}', pages: '{{pages}}' }
  return renderOnDemandPdfResponse({
    kind: 'template_pdf',
    tenantId: ctx.tenantId,
    html: renderTemplate(tpl.compiledHtml, args.values, { escapeHtml: true }),
    paperSize: tpl.paperSize,
    orientation: tpl.orientation,
    marginMm: tpl.marginMm,
    headerHtml: tpl.headerHtml
      ? renderTemplate(tpl.headerHtml, headerVals, { escapeHtml: false })
      : null,
    footerHtml: tpl.footerHtml
      ? renderTemplate(tpl.footerHtml, headerVals, { escapeHtml: false })
      : null,
    entityType: args.entityType,
    entityId: args.entityId,
    filename: args.filename,
  })
}

// Render a module record's PDF: the tenant's configured template (merged with
// the record's values) when one is set, else the adapter's generic
// record-summary. `fallback` overrides the summary for callers whose fallback
// isn't a per-record summary (the vehicle-log month sheet).
export async function renderModulePdfResponse(
  ctx: RequestContext,
  args: { moduleKey: string; recordId: string; fallback?: OnDemandPdfJobData },
): Promise<Response> {
  if (!ctx.tenantId) return Response.json({ error: 'No active tenant' }, { status: 400 })

  const adapter = buildFlowAdapter(ctx, 'module', args.moduleKey, args.recordId)
  if (!adapter) {
    return args.fallback
      ? renderOnDemandPdfResponse(args.fallback)
      : Response.json({ error: 'Unknown module' }, { status: 400 })
  }

  const tpl = await getModuleDefaultTemplate(ctx, args.moduleKey)

  let values: Record<string, unknown> = {}
  try {
    values = await adapter.loadValues()
  } catch {
    values = {}
  }

  if (tpl && Object.keys(values).length > 0) {
    const ref =
      typeof values.reference === 'string' && values.reference
        ? values.reference
        : args.recordId.slice(0, 8)
    return templatePdfResponse(ctx, tpl, {
      values,
      entityType: args.moduleKey,
      entityId: args.recordId,
      filename: `${args.moduleKey}-${ref}.pdf`,
    })
  }

  const fallback: OnDemandPdfJobData =
    args.fallback ??
    adapter.pdfJob?.(values) ??
    buildRecordSummaryPdfJob({
      tenantId: ctx.tenantId,
      subjectId: adapter.subjectId,
      entityType: adapter.auditEntityType,
      heading: adapter.auditEntityType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      reference: values.reference,
      subtitle: values.title,
      values,
    })
  return renderOnDemandPdfResponse(fallback)
}

// Render a Builder form response's PDF: the form template's OWN PDF template
// when one exists, else the generic record-summary built from the form flow
// adapter's values (raw fields + companion keys).
export async function renderFormResponsePdfResponse(
  ctx: RequestContext,
  responseId: string,
): Promise<Response> {
  if (!ctx.tenantId) return Response.json({ error: 'No active tenant' }, { status: 400 })

  const [head] = await ctx.db((tx) =>
    tx
      .select({ templateId: formResponses.templateId, templateName: formTemplates.name })
      .from(formResponses)
      .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
      .where(eq(formResponses.id, responseId))
      .limit(1),
  )
  if (!head) return Response.json({ error: 'Not found' }, { status: 404 })

  const adapter = buildFlowAdapter(ctx, 'form_template', head.templateId, responseId)
  if (!adapter) return Response.json({ error: 'Not found' }, { status: 404 })

  let values: Record<string, unknown> = {}
  try {
    values = await adapter.loadValues()
  } catch {
    values = {}
  }

  const tpl = await getFormTemplateDefaultTemplate(ctx, head.templateId)
  if (tpl && Object.keys(values).length > 0) {
    return templatePdfResponse(ctx, tpl, {
      values,
      entityType: 'form_response',
      entityId: responseId,
      filename: `${head.templateName.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60)}-${responseId.slice(0, 8)}.pdf`,
    })
  }

  return renderOnDemandPdfResponse(
    buildRecordSummaryPdfJob({
      tenantId: ctx.tenantId,
      subjectId: responseId,
      entityType: 'form_response',
      heading: head.templateName,
      reference: responseId.slice(0, 8),
      subtitle: values.title,
      values,
    }),
  )
}

export type ModulePdfDefaultRow = {
  moduleKey: string
  label: string
  options: { id: string; name: string }[]
  selectedId: string | null
}

// For the admin config UI: each target module + its assignable templates + the
// currently-selected default (null = the generic record summary).
export async function listModulePdfDefaults(ctx: RequestContext): Promise<ModulePdfDefaultRow[]> {
  const rows = await ctx.db((tx) =>
    tx
      .select({
        id: pdfTemplates.id,
        name: pdfTemplates.name,
        moduleKey: pdfTemplates.recordSubjectKey,
        isModuleDefault: pdfTemplates.isModuleDefault,
      })
      .from(pdfTemplates)
      .where(
        and(
          isNull(pdfTemplates.deletedAt),
          eq(pdfTemplates.isActive, true),
          eq(pdfTemplates.recordSubjectType, 'module'),
        ),
      )
      .orderBy(asc(pdfTemplates.name)),
  )
  return MODULE_PDF_TARGETS.map((t) => {
    const forModule = rows.filter((r) => r.moduleKey === t.moduleKey)
    return {
      moduleKey: t.moduleKey,
      label: t.label,
      options: forModule.map((r) => ({ id: r.id, name: r.name })),
      selectedId: forModule.find((r) => r.isModuleDefault)?.id ?? null,
    }
  })
}
