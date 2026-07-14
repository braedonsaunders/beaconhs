'use server'

// Server actions for the email-template library. All gated by
// admin.settings.manage (the data-sources / AI-providers tier). HTML compilation
// happens HERE (server-side) on save — the builder's in-canvas compile is preview
// only. All mutations recordAudit (entityType='email_template').

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import { can } from '@beaconhs/tenant'
import { emailTemplates } from '@beaconhs/db/schema'
import { renderEmail } from '@beaconhs/email-render'
import { enqueueEmail } from '@beaconhs/jobs'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { loadTenantEmailTemplate, slugifyTemplateKey } from '@/lib/email-templates'
import { compileBuilderHtml } from '@/lib/template-builder-compile'
import { inlineEmailCss } from '@/lib/email-inline'
import { loadSubjectFields, subjectExists } from '@/lib/flows/subject-fields'
import { isUuid } from '@/lib/list-params'
import {
  isBoundedTemplateSubjectKey,
  normalizeTemplateDescription,
  normalizeTemplateName,
  normalizeTemplateSubject,
  normalizeTemplateTestRecipient,
} from '@/lib/admin-template-input'

const SUBJECT_TYPES = new Set(['module', 'form_template'])

// Mirrors the email_template_category pg enum — an unvalidated cast would let
// a crafted POST surface as a raw DB error.
const CATEGORIES = new Set([
  'general',
  'notification',
  'reminder',
  'approval',
  'digest',
  'marketing',
])
type EmailTemplateCategory =
  'general' | 'notification' | 'reminder' | 'approval' | 'digest' | 'marketing'

function parseCategory(raw: string): EmailTemplateCategory {
  return CATEGORIES.has(raw) ? (raw as EmailTemplateCategory) : 'general'
}

function parseRecordSubject(raw: string): { type: string; key: string } | null {
  if (raw.length > 250) return null
  const idx = raw.indexOf(':')
  if (idx < 0) return null
  const type = raw.slice(0, idx)
  const key = raw.slice(idx + 1)
  if (!SUBJECT_TYPES.has(type) || !isBoundedTemplateSubjectKey(key)) return null
  if (type === 'form_template' && !isUuid(key)) return null
  return { type, key }
}

async function requireManage() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) {
    throw new Error('Not authorized')
  }
  return ctx
}

const STARTER_HTML =
  '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;padding:24px;max-width:680px;margin:0 auto;">' +
  '<h1 style="font-size:20px;margin:0 0 8px;">Hello {{name}}</h1>' +
  '<p style="font-size:14px;line-height:1.6;color:#334155;margin:0;">Write your message here. Drag a field from the left to insert a token like {{site}} that fills in when the flow runs.</p>' +
  '</div>'

export async function createEmailTemplate(formData: FormData): Promise<void> {
  const ctx = await requireManage()
  const name = normalizeTemplateName(formData.get('name'))
  if (!name) return
  const category = parseCategory(String(formData.get('category') ?? 'general'))
  const description = normalizeTemplateDescription(formData.get('description') ?? '')
  if (description === undefined) return

  // Tie the template to a record type so the builder exposes that type's fields.
  const rawSubject = String(formData.get('recordSubject') ?? '')
  const subject = parseRecordSubject(rawSubject)
  if (rawSubject && !subject) return
  if (subject && !(await subjectExists(ctx, subject.type, subject.key))) return
  const subjectFields = subject ? await loadSubjectFields(ctx, subject.type, subject.key) : []
  const mergeFields =
    subjectFields.length > 0
      ? subjectFields.map((f) => ({ key: f.key, label: f.label }))
      : [
          { key: 'reference', label: 'Reference' },
          { key: 'title', label: 'Title' },
        ]

  const base = slugifyTemplateKey(String(formData.get('key') ?? '').trim() || name)
  const compiled = compileBuilderHtml(STARTER_HTML)

  const newId = await ctx.db(async (tx) => {
    const existing = await tx
      .select({ key: emailTemplates.key })
      .from(emailTemplates)
      .where(isNull(emailTemplates.deletedAt))
    const taken = new Set(existing.map((r) => r.key))
    let key = base
    let n = 2
    while (taken.has(key)) key = `${base}-${n++}`

    const [row] = await tx
      .insert(emailTemplates)
      .values({
        tenantId: ctx.tenantId,
        key,
        name,
        description,
        category,
        recordSubjectType: subject?.type ?? null,
        recordSubjectKey: subject?.key ?? null,
        subjectTemplate: name,
        sourceHtml: STARTER_HTML,
        compiledHtml: compiled.html,
        mergeFields,
        createdByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning({ id: emailTemplates.id })
    return row?.id ?? null
  })

  if (newId) {
    await recordAudit(ctx, {
      entityType: 'email_template',
      entityId: newId,
      action: 'create',
      summary: `Created email template "${name}"`,
    })
    revalidatePath('/admin/email-templates')
  }
}

export async function saveEmailTemplateDesign(input: {
  id: string
  name: string
  subjectTemplate: string
  sourceHtml: string
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireManage()
  if (!input || !isUuid(input.id)) return { ok: false, error: 'Invalid template id.' }
  const name = normalizeTemplateName(input.name)
  if (!name) return { ok: false, error: 'Enter a template name of 200 characters or fewer.' }
  const subjectTemplate = normalizeTemplateSubject(input.subjectTemplate)
  if (!subjectTemplate) return { ok: false, error: 'Enter a valid email subject.' }
  if (typeof input.sourceHtml !== 'string') {
    return { ok: false, error: 'The email design is invalid.' }
  }
  // Inline the builder's <style> rules onto elements (email clients strip
  // <style>) BEFORE compile expands the data-each rows into {{#each}}.
  let compiled: ReturnType<typeof compileBuilderHtml>
  try {
    compiled = compileBuilderHtml(inlineEmailCss(input.sourceHtml))
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid email design.' }
  }
  if (compiled.errors.length > 0) return { ok: false, error: compiled.errors.join(' ') }
  const updated = await ctx.db(async (tx) => {
    const [row] = await tx
      .update(emailTemplates)
      .set({
        name,
        subjectTemplate,
        sourceHtml: compiled.sanitizedSource,
        compiledHtml: compiled.html,
        updatedAt: new Date(),
      })
      .where(and(eq(emailTemplates.id, input.id), isNull(emailTemplates.deletedAt)))
      .returning({ id: emailTemplates.id })
    return row ?? null
  })
  if (!updated) return { ok: false, error: 'Template not found.' }
  await recordAudit(ctx, {
    entityType: 'email_template',
    entityId: input.id,
    action: 'update',
    summary: `Saved email template "${name}"`,
  })
  revalidatePath(`/admin/email-templates/${input.id}`)
  revalidatePath('/admin/email-templates')
  return { ok: true }
}

export async function deleteEmailTemplate(formData: FormData): Promise<void> {
  const ctx = await requireManage()
  const id = String(formData.get('id') ?? '')
  if (!isUuid(id)) return
  const deleted = await ctx.db(async (tx) => {
    const [row] = await tx
      .update(emailTemplates)
      .set({ deletedAt: new Date() })
      .where(and(eq(emailTemplates.id, id), isNull(emailTemplates.deletedAt)))
      .returning({ id: emailTemplates.id })
    return row ?? null
  })
  if (!deleted) return
  await recordAudit(ctx, {
    entityType: 'email_template',
    entityId: id,
    action: 'delete',
    summary: 'Deleted email template',
  })
  revalidatePath('/admin/email-templates')
}

export async function sendTestEmailTemplate(input: {
  id: string
  to: string
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireManage()
  if (!input || !isUuid(input.id)) return { ok: false, error: 'Invalid template id.' }
  const to = normalizeTemplateTestRecipient(input.to)
  if (!to) return { ok: false, error: 'Enter a valid email address.' }
  const tpl = await loadTenantEmailTemplate(ctx, input.id)
  if (!tpl) return { ok: false, error: 'Template not found.' }

  // Fill tokens with a [key] placeholder — preferring the subject's live fields,
  // falling back to the stored merge-field snapshot (generic templates).
  const liveFields = await loadSubjectFields(ctx, tpl.recordSubjectType, tpl.recordSubjectKey)
  const sample: Record<string, unknown> = {}
  if (liveFields.length > 0) {
    for (const f of liveFields) sample[f.key] = `[${f.key}]`
  } else {
    for (const f of tpl.mergeFields ?? []) sample[f.key] = f.sample ?? `[${f.key}]`
  }

  const { subject, html, text } = renderEmail(
    { mode: 'template', subjectTemplate: tpl.subjectTemplate, compiledHtml: tpl.compiledHtml },
    sample,
  )
  try {
    await enqueueEmail({
      to,
      subject: `[Test] ${subject}`,
      html,
      text,
      meta: { tenantId: ctx.tenantId, category: 'email_template_test' },
    })
  } catch {
    return { ok: false, error: 'Could not queue the test email.' }
  }
  await recordAudit(ctx, {
    entityType: 'email_template',
    entityId: input.id,
    action: 'send',
    summary: `Queued a test of email template "${tpl.name}"`,
  })
  return { ok: true }
}
