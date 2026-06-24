'use server'

// Server actions for the PDF document-template library. Gated by
// admin.settings.manage. Compile = expand data-each markers → {{#each}} +
// sanitize (shared with email templates). All mutations recordAudit.

import { revalidatePath } from 'next/cache'
import { eq, isNull } from 'drizzle-orm'
import { can } from '@beaconhs/tenant'
import { pdfTemplates } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { compileBuilderHtml, slugifyTemplateKey } from '@/lib/email-templates'
import { loadSubjectFields } from '@/lib/flows/subject-fields'
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

export async function createPdfTemplate(formData: FormData): Promise<void> {
  const ctx = await requireManage()
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return
  const subject = parseRecordSubject(String(formData.get('recordSubject') ?? ''))
  const paperSize = String(formData.get('paperSize') ?? 'letter') as 'letter'
  const orientation = String(formData.get('orientation') ?? 'portrait') as 'portrait'

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
        paperSize: input.paperSize,
        orientation: input.orientation,
        marginMm: input.marginMm,
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
