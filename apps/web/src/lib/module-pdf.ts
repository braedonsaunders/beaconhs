import 'server-only'

// Per-module default PDF templates. A native module's built-in print/PDF button
// normally renders a hard-coded layout (renderIncident / renderHazid / …). A
// tenant can instead author a PDF template (/admin/pdf-templates) tagged for that
// module and flag it as the module default — the print button then renders that
// template, merged with the record's values via the module's flow adapter.
//
// Storage is a single `pdf_templates.is_module_default` flag (one per
// tenant+module). The merge + render reuses the exact chain the flows engine
// already uses: buildFlowAdapter(...).loadValues() → renderTemplate → template_pdf.

import { and, asc, eq, isNull } from 'drizzle-orm'
import { pdfTemplates } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { renderTemplate } from '@beaconhs/email-render'
import type { OnDemandPdfJobData } from '@beaconhs/jobs'
import { buildFlowAdapter } from '@/lib/flows/registry'
import { renderOnDemandPdfResponse } from '@/lib/pdf-route'

// Modules whose print/PDF button can be driven by a tenant template. Each has a
// registered flow adapter (for loadValues + a built-in fallback PDF) AND a
// /…/pdf route wired through renderModulePdfResponse below. Documents are
// excluded — they're hand-authored, so the document *is* the content.
export const MODULE_PDF_TARGETS: { moduleKey: string; label: string }[] = [
  { moduleKey: 'incidents', label: 'Incidents' },
  { moduleKey: 'hazid', label: 'Hazard assessments' },
  { moduleKey: 'corrective-actions', label: 'Corrective actions' },
  { moduleKey: 'equipment', label: 'Equipment work orders' },
  { moduleKey: 'journals', label: 'Journals' },
  { moduleKey: 'inspections', label: 'Inspections' },
]

export function isModulePdfTarget(moduleKey: string): boolean {
  return MODULE_PDF_TARGETS.some((t) => t.moduleKey === moduleKey)
}

type ModuleDefaultTemplate = {
  id: string
  compiledHtml: string
  paperSize: 'letter' | 'a4' | 'legal'
  orientation: 'portrait' | 'landscape'
  marginMm: number
  headerHtml: string | null
  footerHtml: string | null
}

export async function getModuleDefaultTemplate(
  ctx: RequestContext,
  moduleKey: string,
): Promise<ModuleDefaultTemplate | null> {
  const [t] = await ctx.db((tx) =>
    tx
      .select({
        id: pdfTemplates.id,
        compiledHtml: pdfTemplates.compiledHtml,
        paperSize: pdfTemplates.paperSize,
        orientation: pdfTemplates.orientation,
        marginMm: pdfTemplates.marginMm,
        headerHtml: pdfTemplates.headerHtml,
        footerHtml: pdfTemplates.footerHtml,
      })
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

// Render a module record's PDF: the tenant's configured template (merged with
// the record's values) when one is set, else the module's built-in PDF — the
// route's bespoke renderer (`builtin`) when it has one, otherwise the adapter's
// generic record-summary. Any failure merging the template falls back to the
// built-in rather than producing a blank document.
export async function renderModulePdfResponse(
  ctx: RequestContext,
  args: { moduleKey: string; recordId: string; builtin?: OnDemandPdfJobData },
): Promise<Response> {
  if (!ctx.tenantId) return Response.json({ error: 'No active tenant' }, { status: 400 })

  const adapter = buildFlowAdapter(ctx, 'module', args.moduleKey, args.recordId)
  if (!adapter) {
    return args.builtin
      ? renderOnDemandPdfResponse(args.builtin)
      : Response.json({ error: 'Unknown module' }, { status: 400 })
  }

  const tpl = await getModuleDefaultTemplate(ctx, args.moduleKey)

  // Load the record's values only when needed — to merge into a template, or to
  // build the adapter's generic record-summary when there's no bespoke renderer.
  let values: Record<string, unknown> = {}
  if (tpl || !args.builtin) {
    try {
      values = await adapter.loadValues()
    } catch {
      values = {}
    }
  }

  if (tpl && Object.keys(values).length > 0) {
    const ref =
      typeof values.reference === 'string' && values.reference
        ? values.reference
        : args.recordId.slice(0, 8)
    return renderOnDemandPdfResponse({
      kind: 'template_pdf',
      tenantId: ctx.tenantId,
      html: renderTemplate(tpl.compiledHtml, values, { escapeHtml: true }),
      paperSize: tpl.paperSize,
      orientation: tpl.orientation,
      marginMm: tpl.marginMm,
      headerHtml: tpl.headerHtml
        ? renderTemplate(tpl.headerHtml, values, { escapeHtml: false })
        : null,
      footerHtml: tpl.footerHtml
        ? renderTemplate(tpl.footerHtml, values, { escapeHtml: false })
        : null,
      entityType: args.moduleKey,
      entityId: args.recordId,
      filename: `${args.moduleKey}-${ref}.pdf`,
    })
  }

  const fallback: OnDemandPdfJobData | null = args.builtin ?? adapter.pdfJob?.(values) ?? null
  if (!fallback) {
    return Response.json({ error: 'No PDF is available for this record.' }, { status: 404 })
  }
  return renderOnDemandPdfResponse(fallback)
}

export type ModulePdfDefaultRow = {
  moduleKey: string
  label: string
  options: { id: string; name: string }[]
  selectedId: string | null
}

// For the admin config UI: each target module + its assignable templates + the
// currently-selected default (null = built-in).
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
