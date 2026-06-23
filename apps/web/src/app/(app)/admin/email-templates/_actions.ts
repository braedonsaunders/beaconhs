'use server'

// Server actions for the email-template library. All gated by
// admin.settings.manage (the data-sources / AI-providers tier). The MJML compile
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
import {
  compileEmailMjml,
  loadTenantEmailTemplate,
  slugifyTemplateKey,
} from '@/lib/email-templates'

async function requireManage() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) {
    throw new Error('Not authorized')
  }
  return ctx
}

const STARTER_MJML =
  '<mjml><mj-body><mj-section><mj-column>' +
  '<mj-text font-size="20px" font-weight="bold">Hello {{name}}</mj-text>' +
  '<mj-text>Write your message here. Insert tokens like {{site}} that fill in when the flow runs.</mj-text>' +
  '<mj-button href="https://example.com">Open</mj-button>' +
  '</mj-column></mj-section></mj-body></mjml>'

export async function createEmailTemplate(formData: FormData): Promise<void> {
  const ctx = await requireManage()
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return
  const category = String(formData.get('category') ?? 'general')
  const description = String(formData.get('description') ?? '').trim() || null

  const base = slugifyTemplateKey(String(formData.get('key') ?? '').trim() || name)
  const compiled = compileEmailMjml(STARTER_MJML)

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
        category: category as 'general',
        subjectTemplate: name,
        mjmlSource: STARTER_MJML,
        compiledHtml: compiled.html,
        mergeFields: [
          { key: 'name', label: 'Recipient / subject name' },
          { key: 'site', label: 'Site' },
        ],
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
  design: Record<string, unknown>
  mjmlSource: string
}): Promise<{ ok: boolean; error?: string; warnings?: string[] }> {
  const ctx = await requireManage()
  if (!input.id) return { ok: false, error: 'Missing template id.' }
  const compiled = compileEmailMjml(input.mjmlSource)
  await ctx.db((tx) =>
    tx
      .update(emailTemplates)
      .set({
        name: input.name.trim() || 'Untitled',
        subjectTemplate: input.subjectTemplate,
        design: input.design,
        mjmlSource: input.mjmlSource,
        compiledHtml: compiled.html,
        updatedAt: new Date(),
      })
      .where(eq(emailTemplates.id, input.id)),
  )
  await recordAudit(ctx, {
    entityType: 'email_template',
    entityId: input.id,
    action: 'update',
    summary: `Saved email template "${input.name}"`,
  })
  revalidatePath(`/admin/email-templates/${input.id}`)
  revalidatePath('/admin/email-templates')
  return { ok: true, warnings: compiled.errors }
}

export async function renameEmailTemplate(formData: FormData): Promise<void> {
  const ctx = await requireManage()
  const id = String(formData.get('id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (!id || !name) return
  await ctx.db((tx) =>
    tx.update(emailTemplates).set({ name, updatedAt: new Date() }).where(eq(emailTemplates.id, id)),
  )
  revalidatePath('/admin/email-templates')
}

export async function setEmailTemplateActive(formData: FormData): Promise<void> {
  const ctx = await requireManage()
  const id = String(formData.get('id') ?? '')
  const isActive = String(formData.get('isActive') ?? '') === 'true'
  if (!id) return
  await ctx.db((tx) =>
    tx
      .update(emailTemplates)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(emailTemplates.id, id)),
  )
  revalidatePath('/admin/email-templates')
}

export async function deleteEmailTemplate(formData: FormData): Promise<void> {
  const ctx = await requireManage()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await ctx.db((tx) =>
    tx.update(emailTemplates).set({ deletedAt: new Date() }).where(eq(emailTemplates.id, id)),
  )
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
  const to = input.to.trim()
  if (!to.includes('@')) return { ok: false, error: 'Enter a valid email address.' }
  const tpl = await loadTenantEmailTemplate(ctx, input.id)
  if (!tpl) return { ok: false, error: 'Template not found.' }

  // Fill tokens with each merge field's sample (or a [key] placeholder).
  const sample: Record<string, unknown> = {}
  for (const f of tpl.mergeFields ?? []) sample[f.key] = f.sample ?? `[${f.key}]`

  const { subject, html, text } = renderEmail(
    { mode: 'template', subjectTemplate: tpl.subjectTemplate, compiledHtml: tpl.compiledHtml },
    sample,
  )
  await enqueueEmail({
    to,
    subject: `[Test] ${subject}`,
    html,
    text,
    meta: { tenantId: ctx.tenantId, category: 'email_template_test' },
  })
  return { ok: true }
}
