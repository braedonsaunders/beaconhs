'use server'

// AI Builder server actions — generate an App (form template) or a Flow
// (automation graph) from a prompt. Gated by `forms.ai.generate` (Admins +
// Safety Managers). The AI only drafts; the result opens in the visual builder.

import { revalidatePath } from 'next/cache'
import { desc, eq } from 'drizzle-orm'
import { assertCan } from '@beaconhs/tenant'
import { formAutomations, formTemplateVersions, formTemplates } from '@beaconhs/db/schema'
import { validateFormSchema } from '@beaconhs/forms-core'
import type { FormSchemaV1 } from '@beaconhs/forms-core'
import { requireRequestContext } from '@/lib/auth'
import { getTenantAiConfig } from '@/lib/ai-config'
import { recordAudit } from '@/lib/audit'
import { appendMessage, createConversation } from '@/lib/ai-conversations'
import { generateAppEdit, generateAppFromPrompt, generateFlowFromPrompt } from './_lib/ai-generate'

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 48) || 'app'
  )
}

// One conversational turn of the App builder assistant. The AI can BUILD a new
// app or EDIT the current one (it always receives the live schema). Persists the
// exchange to the global ai_conversations history (scope 'builder.app'). Returns
// the proposed schema for the editor to Apply — never auto-publishes.
export async function runAppBuilderChat(args: {
  conversationId: string | null
  templateId: string
  currentSchema: FormSchemaV1
  prompt: string
}): Promise<{
  ok: boolean
  error?: string
  conversationId?: string
  reply?: string
  schema?: FormSchemaV1
  warnings?: string[]
}> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'forms.ai.generate')
  const prompt = (args.prompt ?? '').trim()
  if (prompt.length < 2) return { ok: false, error: 'Tell the assistant what to build or change.' }

  const aiConfig = await getTenantAiConfig(ctx)
  if (!aiConfig) {
    return { ok: false, error: 'AI is not configured. Set a provider + key under Admin → AI.' }
  }

  // Ensure a conversation, then record the user's message.
  let conversationId = args.conversationId
  if (!conversationId) {
    conversationId = await createConversation({
      scope: 'builder.app',
      scopeRefId: args.templateId,
      title: prompt.slice(0, 60),
    })
  }
  await appendMessage({ conversationId, role: 'user', content: prompt })

  const gen = await generateAppEdit(aiConfig, prompt, args.currentSchema)
  if (!gen.ok) {
    await appendMessage({
      conversationId,
      role: 'assistant',
      content: `Generation failed — ${gen.error}`,
    })
    return { ok: false, error: gen.error, conversationId }
  }

  const fieldCount = gen.value.sections.reduce((n, s) => n + s.fields.length, 0)
  const reply = `Done. The app now has ${gen.value.sections.length} section${
    gen.value.sections.length === 1 ? '' : 's'
  } and ${fieldCount} field${fieldCount === 1 ? '' : 's'}. Review it and hit Apply to load it into the builder.`
  await appendMessage({
    conversationId,
    role: 'assistant',
    content: reply,
    data: { schema: gen.value },
  })

  await recordAudit(ctx, {
    entityType: 'form_template',
    entityId: args.templateId,
    action: 'update',
    summary: 'AI builder chat turn',
    after: { mode: 'ai-chat', prompt: prompt.slice(0, 200) },
  })

  return { ok: true, conversationId, reply, schema: gen.value, warnings: gen.warnings }
}

export async function generateAppDraft(
  prompt: string,
): Promise<{ ok: boolean; templateId?: string; error?: string; warnings?: string[] }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'forms.ai.generate')
  const trimmed = (prompt ?? '').trim()
  if (trimmed.length < 4)
    return { ok: false, error: 'Describe the app you want in a sentence or two.' }

  const aiConfig = await getTenantAiConfig(ctx)
  if (!aiConfig)
    return { ok: false, error: 'AI is not configured. Set a provider + key under Admin → AI.' }

  const gen = await generateAppFromPrompt(aiConfig, trimmed)
  if (!gen.ok) return { ok: false, error: gen.error }

  const schema = validateFormSchema(gen.value) // defensive re-validate before persisting
  const name = schema.title?.en?.trim() || 'AI app'

  const templateId = await ctx.db(async (tx) => {
    const key = `${slugify(name)}_${Math.random().toString(36).slice(2, 6)}`
    const [tmpl] = await tx
      .insert(formTemplates)
      .values({
        tenantId: ctx.tenantId,
        key,
        name,
        description: schema.description?.en ?? null,
        status: 'draft',
        createdBy: ctx.userId,
      })
      .returning({ id: formTemplates.id })
    if (!tmpl) throw new Error('Failed to insert form template')
    await tx.insert(formTemplateVersions).values({
      tenantId: ctx.tenantId,
      templateId: tmpl.id,
      version: 1,
      schema,
    })
    return tmpl.id
  })

  await recordAudit(ctx, {
    entityType: 'form_template',
    entityId: templateId,
    action: 'create',
    summary: `AI-generated app "${name}"`,
    after: { mode: 'ai', prompt: trimmed.slice(0, 200) },
  })
  revalidatePath('/forms')
  return { ok: true, templateId, warnings: gen.warnings }
}

export async function generateFlowDraft(
  flowId: string,
  prompt: string,
): Promise<{
  ok: boolean
  error?: string
  warnings?: string[]
  graph?: import('@beaconhs/forms-core').AutomationGraph
}> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'forms.ai.generate')
  const trimmed = (prompt ?? '').trim()
  if (!flowId || trimmed.length < 4) return { ok: false, error: 'Describe the flow you want.' }

  const aiConfig = await getTenantAiConfig(ctx)
  if (!aiConfig)
    return { ok: false, error: 'AI is not configured. Set a provider + key under Admin → AI.' }

  // Resolve the flow → its template → field ids (power condition/field refs).
  const fieldIds = await ctx.db(async (tx) => {
    const [flow] = await tx
      .select({ templateId: formAutomations.templateId })
      .from(formAutomations)
      .where(eq(formAutomations.id, flowId))
      .limit(1)
    if (!flow) return null
    if (!flow.templateId) return [] // module flow — no template schema to read
    const [v] = await tx
      .select({ schema: formTemplateVersions.schema })
      .from(formTemplateVersions)
      .where(eq(formTemplateVersions.templateId, flow.templateId))
      .orderBy(desc(formTemplateVersions.version))
      .limit(1)
    const ids: string[] = []
    for (const sec of v?.schema?.sections ?? []) for (const f of sec.fields) ids.push(f.id)
    return ids
  })
  if (fieldIds === null) return { ok: false, error: 'Flow not found.' }

  const gen = await generateFlowFromPrompt(aiConfig, trimmed, fieldIds)
  if (!gen.ok) return { ok: false, error: gen.error }

  await ctx.db((tx) =>
    tx
      .update(formAutomations)
      .set({ graph: gen.value, updatedAt: new Date() })
      .where(eq(formAutomations.id, flowId)),
  )
  await recordAudit(ctx, {
    entityType: 'form_template',
    entityId: flowId,
    action: 'update',
    summary: 'AI-generated flow',
    after: { mode: 'ai', prompt: trimmed.slice(0, 200) },
  })
  return { ok: true, warnings: gen.warnings, graph: gen.value }
}
