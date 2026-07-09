'use server'

// Server actions for the PDF document-template library. Gated by
// admin.settings.manage. Compile = expand data-each markers → {{#each}} +
// sanitize (shared with email templates). All mutations recordAudit.

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import { can } from '@beaconhs/tenant'
import { pdfTemplates } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { compileBuilderHtml, slugifyTemplateKey } from '@/lib/email-templates'
import { loadSubjectFields } from '@/lib/flows/subject-fields'
import { isModulePdfTarget } from '@/lib/module-pdf'
import { loadTenantPdfTemplate } from '@/lib/pdf-templates'
import { buildFlowAdapter } from '@/lib/flows/registry'
import { findSampleSubjectId } from '@/lib/flows/sample-record'

async function requireManage() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) {
    throw new Error('Not authorized')
  }
  return ctx
}

const SUBJECT_TYPES = new Set(['module', 'form_template'])
function parseRecordSubject(raw: string): { type: string; key: string } | null {
  const idx = raw.indexOf(':')
  if (idx < 0) return null
  const type = raw.slice(0, idx)
  const key = raw.slice(idx + 1)
  if (!SUBJECT_TYPES.has(type) || !key) return null
  return { type, key }
}

const STARTER_HTML =
  '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;">' +
  '<h1 style="font-size:22px;margin:0 0 8px;">Document title</h1>' +
  '<p style="font-size:13px;line-height:1.6;color:#334155;margin:0;">Drag content + record fields from the left. Use the Preview tab to see real pages.</p>' +
  '</div>'

// Runtime whitelists mirroring the pdf_paper_size / pdf_orientation pg enums —
// an unvalidated cast would let a crafted POST surface as a raw DB error.
type PaperSize = 'letter' | 'a4' | 'legal'
type Orientation = 'portrait' | 'landscape'

function parsePaperSize(raw: unknown): PaperSize {
  const v = String(raw ?? '')
  return v === 'a4' || v === 'legal' ? v : 'letter'
}

function parseOrientation(raw: unknown): Orientation {
  return String(raw ?? '') === 'landscape' ? 'landscape' : 'portrait'
}

// Keep margins in a printable range (schema default is 16mm).
function clampMarginMm(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 16
  return Math.min(50, Math.max(0, Math.round(n)))
}

export async function createPdfTemplate(formData: FormData): Promise<void> {
  const ctx = await requireManage()
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return
  const subject = parseRecordSubject(String(formData.get('recordSubject') ?? ''))
  const paperSize = parsePaperSize(formData.get('paperSize'))
  const orientation = parseOrientation(formData.get('orientation'))

  const subjectFields = subject ? await loadSubjectFields(ctx, subject.type, subject.key) : []
  const mergeFields =
    subjectFields.length > 0
      ? subjectFields.map((f) => ({ key: f.key, label: f.label }))
      : [{ key: 'reference', label: 'Reference' }]

  const base = slugifyTemplateKey(name)
  const compiled = compileBuilderHtml(STARTER_HTML)

  const newId = await ctx.db(async (tx) => {
    const existing = await tx
      .select({ key: pdfTemplates.key })
      .from(pdfTemplates)
      .where(isNull(pdfTemplates.deletedAt))
    const taken = new Set(existing.map((r) => r.key))
    let key = base
    let n = 2
    while (taken.has(key)) key = `${base}-${n++}`
    const [row] = await tx
      .insert(pdfTemplates)
      .values({
        tenantId: ctx.tenantId,
        key,
        name,
        recordSubjectType: subject?.type ?? null,
        recordSubjectKey: subject?.key ?? null,
        paperSize,
        orientation,
        compiledHtml: compiled.html,
        sourceHtml: STARTER_HTML,
        mergeFields,
        footerHtml: 'Page {{page}} of {{pages}}',
        createdByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning({ id: pdfTemplates.id })
    return row?.id ?? null
  })

  if (newId) {
    await recordAudit(ctx, {
      entityType: 'pdf_template',
      entityId: newId,
      action: 'create',
      summary: `Created PDF template "${name}"`,
    })
    revalidatePath('/admin/pdf-templates')
  }
}

export async function savePdfTemplateDesign(input: {
  id: string
  name: string
  design: Record<string, unknown>
  sourceHtml: string
  paperSize: 'letter' | 'a4' | 'legal'
  orientation: 'portrait' | 'landscape'
  marginMm: number
  headerHtml: string
  footerHtml: string
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireManage()
  if (!input.id) return { ok: false, error: 'Missing template id.' }
  const compiled = compileBuilderHtml(input.sourceHtml)
  await ctx.db((tx) =>
    tx
      .update(pdfTemplates)
      .set({
        name: input.name.trim() || 'Untitled',
        design: input.design,
        sourceHtml: input.sourceHtml,
        compiledHtml: compiled.html,
        paperSize: parsePaperSize(input.paperSize),
        orientation: parseOrientation(input.orientation),
        marginMm: clampMarginMm(input.marginMm),
        headerHtml: input.headerHtml,
        footerHtml: input.footerHtml,
        updatedAt: new Date(),
      })
      .where(eq(pdfTemplates.id, input.id)),
  )
  await recordAudit(ctx, {
    entityType: 'pdf_template',
    entityId: input.id,
    action: 'update',
    summary: `Saved PDF template "${input.name}"`,
  })
  revalidatePath(`/admin/pdf-templates/${input.id}`)
  revalidatePath('/admin/pdf-templates')
  return { ok: true }
}

// Resolve a real sample record's field-map so the Preview tab fills {{tokens}}
// and {{#each}} tables with live data instead of [placeholders]. Returns null
// values when the template has no record subject or the tenant has no records
// of that type (the client falls back to placeholder sample data).
export async function loadPdfPreviewData(
  templateId: string,
): Promise<{ values: Record<string, unknown> | null; sampleRef: string | null }> {
  const ctx = await requireManage()
  const tpl = await loadTenantPdfTemplate(ctx, templateId)
  if (!tpl?.recordSubjectType) return { values: null, sampleRef: null }

  const sampleId = await findSampleSubjectId(ctx, tpl.recordSubjectType, tpl.recordSubjectKey)
  if (!sampleId) return { values: null, sampleRef: null }

  const adapter = buildFlowAdapter(
    ctx,
    tpl.recordSubjectType as 'module' | 'form_template',
    tpl.recordSubjectKey,
    sampleId,
  )
  if (!adapter) return { values: null, sampleRef: null }

  try {
    const values = await adapter.loadValues()
    const ref = typeof values.reference === 'string' ? values.reference : null
    return { values, sampleRef: ref ?? sampleId.slice(0, 8) }
  } catch {
    return { values: null, sampleRef: null }
  }
}

// Assign (or clear) the default print/PDF template for a native module. Clearing
// reverts that module's print button to the generic field-summary PDF. At most one
// template is the default per (tenant, module) — the partial unique index backs
// this; we also clear the prior default first so re-assigning is idempotent.
export async function setModuleDefaultTemplate(input: {
  moduleKey: string
  templateId: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireManage()
  if (!isModulePdfTarget(input.moduleKey)) return { ok: false, error: 'Unknown module' }

  await ctx.db(async (tx) => {
    await tx
      .update(pdfTemplates)
      .set({ isModuleDefault: false })
      .where(
        and(
          eq(pdfTemplates.recordSubjectType, 'module'),
          eq(pdfTemplates.recordSubjectKey, input.moduleKey),
          eq(pdfTemplates.isModuleDefault, true),
        ),
      )
    if (input.templateId) {
      await tx
        .update(pdfTemplates)
        .set({ isModuleDefault: true })
        .where(
          and(
            eq(pdfTemplates.id, input.templateId),
            eq(pdfTemplates.recordSubjectType, 'module'),
            eq(pdfTemplates.recordSubjectKey, input.moduleKey),
            isNull(pdfTemplates.deletedAt),
          ),
        )
    }
  })

  await recordAudit(ctx, {
    entityType: 'pdf_template',
    entityId: input.templateId ?? input.moduleKey,
    action: 'update',
    summary: input.templateId
      ? `Set default print template for ${input.moduleKey}`
      : `Reverted ${input.moduleKey} print button to the field-summary PDF`,
  })
  revalidatePath('/admin/pdf-templates')
  return { ok: true }
}

export async function deletePdfTemplate(formData: FormData): Promise<void> {
  const ctx = await requireManage()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await ctx.db((tx) =>
    tx.update(pdfTemplates).set({ deletedAt: new Date() }).where(eq(pdfTemplates.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'pdf_template',
    entityId: id,
    action: 'delete',
    summary: 'Deleted PDF template',
  })
  revalidatePath('/admin/pdf-templates')
}
