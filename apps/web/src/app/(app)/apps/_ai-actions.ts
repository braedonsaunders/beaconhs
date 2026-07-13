'use server'

// AI Builder server actions — generate an App (form template) or a Flow
// (automation graph) from a prompt. Gated by `forms.ai.generate` (Admins +
// Safety Managers). The AI only drafts; the result opens in the visual builder.

import { revalidatePath } from 'next/cache'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { assertCan } from '@beaconhs/tenant'
import {
  aiConversations,
  formAutomations,
  formTemplateVersions,
  formTemplates,
} from '@beaconhs/db/schema'
import { lintWorkerTriggerCompatibility, validateFormSchema } from '@beaconhs/forms-core'
import type { FormSchemaV1 } from '@beaconhs/forms-core'
import { requireRequestContext } from '@/lib/auth'
import { getTenantAiConfig } from '@/lib/ai-config'
import { recordAudit } from '@/lib/audit'
import { appendMessage, createConversation } from '@/lib/ai-conversations'
import { generateAppEdit, generateAppFromPrompt, generateFlowFromPrompt } from './_lib/ai-generate'
import { slugify } from './_lib/slug'
import { isUuid } from '@/lib/list-params'
import { parseFlowGraph } from '@/lib/flows/flow-policy'

const MAX_AI_PROMPT_LENGTH = 8_000
const MAX_AI_SCHEMA_BYTES = 1024 * 1024
const MAX_AI_SCHEMA_SECTIONS = 50
const MAX_AI_SCHEMA_FIELDS = 500

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
  if (!args || typeof args !== 'object' || !isUuid(args.templateId)) {
    return { ok: false, error: 'App not found.' }
  }
  if (typeof args.prompt !== 'string' || args.prompt.length > MAX_AI_PROMPT_LENGTH) {
    return { ok: false, error: 'The request is invalid or too large.' }
  }
  if (args.conversationId !== null && !isUuid(args.conversationId)) {
    return { ok: false, error: 'Conversation not found.' }
  }
  let currentSchema: FormSchemaV1
  try {
    currentSchema = validateFormSchema(args.currentSchema)
  } catch {
    return { ok: false, error: 'The current app schema is invalid.' }
  }
  const fieldCount = currentSchema.sections.reduce(
    (count, section) => count + section.fields.length,
    0,
  )
  if (
    new TextEncoder().encode(JSON.stringify(currentSchema)).byteLength > MAX_AI_SCHEMA_BYTES ||
    currentSchema.sections.length > MAX_AI_SCHEMA_SECTIONS ||
    fieldCount > MAX_AI_SCHEMA_FIELDS
  ) {
    return { ok: false, error: 'The current app is too large for an AI editing turn.' }
  }
  const [template] = await ctx.db((tx) =>
    tx
      .select({ id: formTemplates.id })
      .from(formTemplates)
      .where(and(eq(formTemplates.id, args.templateId), isNull(formTemplates.deletedAt)))
      .limit(1),
  )
  if (!template) return { ok: false, error: 'App not found.' }
  const prompt = args.prompt.trim()
  if (prompt.length < 2) return { ok: false, error: 'Tell the assistant what to build or change.' }

  const aiConfig = await getTenantAiConfig(ctx)
  if (!aiConfig) {
    return { ok: false, error: 'AI is not configured. Set a provider + key under Admin → AI.' }
  }

  // Ensure a conversation, then record the user's message.
  let conversationId = args.conversationId
  if (conversationId) {
    const [conversation] = await ctx.db((tx) =>
      tx
        .select({
          userId: aiConversations.userId,
          scope: aiConversations.scope,
          scopeRefId: aiConversations.scopeRefId,
        })
        .from(aiConversations)
        .where(eq(aiConversations.id, conversationId!))
        .limit(1),
    )
    if (
      !conversation ||
      conversation.userId !== ctx.userId ||
      conversation.scope !== 'builder.app' ||
      conversation.scopeRefId !== args.templateId
    ) {
      return { ok: false, error: 'Conversation not found.' }
    }
  }
  if (!conversationId) {
    conversationId = await createConversation({
      scope: 'builder.app',
      scopeRefId: args.templateId,
      title: prompt.slice(0, 60),
    })
  }
  await appendMessage({ conversationId, role: 'user', content: prompt })

  const gen = await generateAppEdit(aiConfig, prompt, currentSchema)
  if (!gen.ok) {
    await appendMessage({
      conversationId,
      role: 'assistant',
      content: `Generation failed — ${gen.error}`,
    })
    return { ok: false, error: gen.error, conversationId }
  }

  const generatedFieldCount = gen.value.sections.reduce((n, s) => n + s.fields.length, 0)
  const reply = `Done. The app now has ${gen.value.sections.length} section${
    gen.value.sections.length === 1 ? '' : 's'
  } and ${generatedFieldCount} field${generatedFieldCount === 1 ? '' : 's'}. Review it and hit Apply to load it into the builder.`
  await appendMessage({
    conversationId,
    role: 'assistant',
    content: reply,
    data: { schema: gen.value },
  })

  // No audit here: a chat turn mutates nothing on the template (the exchange is
  // already persisted to ai_conversations, and applying/publishing the proposed
  // schema audits through the designer's save/publish actions). Logging an
  // 'update' per turn would pollute the template's audit trail.
  return { ok: true, conversationId, reply, schema: gen.value, warnings: gen.warnings }
}

export async function generateAppDraft(
  prompt: string,
): Promise<{ ok: boolean; templateId?: string; error?: string; warnings?: string[] }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'forms.ai.generate')
  if (typeof prompt !== 'string' || prompt.length > MAX_AI_PROMPT_LENGTH) {
    return { ok: false, error: 'The request is invalid or too large.' }
  }
  const trimmed = prompt.trim()
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
    const key = `${slugify(name) || 'app'}_${Math.random().toString(36).slice(2, 6)}`
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
  revalidatePath('/apps')
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
  assertCan(ctx, 'forms.template.create')
  if (!isUuid(flowId) || typeof prompt !== 'string' || prompt.length > MAX_AI_PROMPT_LENGTH) {
    return { ok: false, error: 'Flow not found or request too large.' }
  }
  const trimmed = prompt.trim()
  if (trimmed.length < 4) return { ok: false, error: 'Describe the flow you want.' }

  const aiConfig = await getTenantAiConfig(ctx)
  if (!aiConfig)
    return { ok: false, error: 'AI is not configured. Set a provider + key under Admin → AI.' }

  // Resolve the flow → its template → field ids (power condition/field refs).
  const resolved = await ctx.db(async (tx) => {
    const [flow] = await tx
      .select({ templateId: formAutomations.templateId })
      .from(formAutomations)
      .where(eq(formAutomations.id, flowId))
      .limit(1)
    if (!flow) return null
    if (!flow.templateId) return null
    const [v] = await tx
      .select({ schema: formTemplateVersions.schema })
      .from(formTemplateVersions)
      .where(eq(formTemplateVersions.templateId, flow.templateId))
      .orderBy(desc(formTemplateVersions.version))
      .limit(1)
    const ids: string[] = []
    for (const sec of v?.schema?.sections ?? []) for (const f of sec.fields) ids.push(f.id)
    return { templateId: flow.templateId, fieldIds: ids }
  })
  if (resolved === null) return { ok: false, error: 'Flow not found.' }
  const { templateId, fieldIds } = resolved

  const gen = await generateFlowFromPrompt(aiConfig, trimmed, fieldIds)
  if (!gen.ok) return { ok: false, error: gen.error }
  if (gen.warnings.length > 0) return { ok: false, error: gen.warnings[0] }
  const graph = parseFlowGraph(gen.value)
  if (!graph.ok) return graph
  const compatibilityErrors = lintWorkerTriggerCompatibility(graph.graph)
  if (compatibilityErrors.length > 0) return { ok: false, error: compatibilityErrors[0] }

  await ctx.db((tx) =>
    tx
      .update(formAutomations)
      .set({ graph: graph.graph, updatedAt: new Date() })
      .where(and(eq(formAutomations.id, flowId), eq(formAutomations.templateId, templateId!))),
  )
  await recordAudit(ctx, {
    entityType: 'form_automation',
    entityId: flowId,
    action: 'update',
    summary: 'AI-generated flow',
    after: { mode: 'ai', prompt: trimmed.slice(0, 200) },
    metadata: { templateId },
  })
  return { ok: true, warnings: gen.warnings, graph: graph.graph }
}
