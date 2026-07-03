// The agentic turn endpoint. Streams a multi-step tool-using assistant turn over
// the UI-message protocol (decoded client-side by readUIMessageStream) and
// persists the assembled transcript into ai_messages on finish.
//
// Mirrors the contract of journals/ai/route.ts but for a full agent loop.

import { convertToModelMessages, type UIMessage } from 'ai'
import { runAgentTurn, AIDisabledError, providerSupportsImageToolResults } from '@beaconhs/ai'
import { can } from '@beaconhs/tenant'
import { getRequestContext } from '@/lib/auth'
import { getTenantAiConfig } from '@/lib/ai-config'
import {
  appendMessage,
  createConversation,
  getConversationMessages,
  resolveConversationAccess,
} from '@/lib/ai-conversations'
import { buildToolRegistry } from '@/lib/assistant/registry'
import { assistantSystemPrompt } from '@/lib/assistant/system-prompt'

export const dynamic = 'force-dynamic'
// Agent turns run a multi-step tool loop — far longer than a single completion.
export const maxDuration = 300

const SCOPE = 'assistant'
const MAX_HISTORY = 40

// Conversation ids are uuid PKs — reject malformed ids before they reach a
// uuid-typed column comparison (Postgres errors on invalid uuid input).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Vision tool (view_document_pages) results carry base64 page images so the
// model can SEE them this turn — but they must NOT be written into the saved
// transcript (DB bloat, and they'd be re-sent every later turn). The browser
// still receives the full images over the live stream; we strip them only from
// the persisted copy, leaving the lightweight page metadata behind.
function stripVisionImages(parts: UIMessage['parts']): UIMessage['parts'] {
  return parts.map((p) => {
    if (p.type !== 'tool-view_document_pages') return p
    const out = (p as { output?: { data?: Record<string, unknown> } }).output
    const images = out?.data?.images
    if (!Array.isArray(images) || images.length === 0) return p
    return {
      ...p,
      output: { ...out, data: { ...out!.data, images: [] } },
    } as typeof p
  })
}

export async function POST(req: Request): Promise<Response> {
  const ctx = await getRequestContext()
  if (!ctx) return new Response('Unauthorized', { status: 401 })
  if (!can(ctx, 'assistant.use')) return new Response('Forbidden', { status: 403 })

  let body: { conversationId?: string; prompt?: string }
  try {
    body = await req.json()
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  const prompt = (body.prompt ?? '').trim()
  if (!prompt) return new Response('Empty prompt', { status: 400 })

  // Resolve / create the conversation. Only the OWNER may send a turn.
  let conversationId = body.conversationId ?? null
  if (conversationId) {
    if (!UUID.test(conversationId)) return new Response('Bad request', { status: 400 })
    if ((await resolveConversationAccess(conversationId)) !== 'owner') {
      return new Response('Forbidden', { status: 403 })
    }
  } else {
    conversationId = await createConversation({ scope: SCOPE, title: prompt.slice(0, 60) })
  }

  // Persist the user message FIRST so a dropped connection never loses the turn.
  await appendMessage({ conversationId, role: 'user', content: prompt })

  const aiConfig = await getTenantAiConfig(ctx)
  // Vision tools (rendered scanned-PDF pages) are only exposed when the provider
  // accepts image content in a tool result — currently Anthropic.
  const tools = buildToolRegistry(ctx, {
    imageToolResults: providerSupportsImageToolResults(aiConfig),
  })

  // Rebuild the model transcript from persisted history (cap to recent turns).
  const history = (await getConversationMessages(conversationId)).slice(-MAX_HISTORY)
  const uiMessages = history.map((m) => ({
    role: m.role,
    parts:
      m.data && Array.isArray((m.data as { parts?: unknown }).parts)
        ? ((m.data as { parts: unknown }).parts as UIMessage['parts'])
        : ([{ type: 'text', text: m.content }] as UIMessage['parts']),
  }))

  let modelMessages
  try {
    modelMessages = await convertToModelMessages(uiMessages, {
      tools,
      ignoreIncompleteToolCalls: true,
    })
  } catch {
    // Fall back to a plain text transcript if a stored part can't be converted.
    modelMessages = await convertToModelMessages(
      history.map((m) => ({ role: m.role, parts: [{ type: 'text', text: m.content }] })),
      { ignoreIncompleteToolCalls: true },
    )
  }

  const system = assistantSystemPrompt({
    orgName: aiConfig?.org?.name ?? null,
    userName: ctx.membership?.displayName ?? null,
    today: new Date().toISOString().slice(0, 10),
    canWrite: can(ctx, 'assistant.write'),
  })

  try {
    const res = runAgentTurn(aiConfig, {
      messages: modelMessages,
      system,
      tools,
      abortSignal: req.signal,
      onComplete: async ({ parts, aborted, finishReason, usage }) => {
        const text = parts
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join('\n')
          .trim()
        await appendMessage({
          conversationId: conversationId!,
          role: 'assistant',
          content: text || (aborted ? '(stopped)' : ''),
          data: {
            v: 1,
            kind: 'agent-turn',
            finishReason,
            aborted,
            usage,
            parts: stripVisionImages(parts),
          },
        })
      },
    })

    // Surface the (possibly new) conversation id to the client.
    const headers = new Headers(res.headers)
    headers.set('x-conversation-id', conversationId)
    return new Response(res.body, { status: res.status, headers })
  } catch (err) {
    if (err instanceof AIDisabledError) {
      return new Response('AI is not configured for this workspace.', { status: 503 })
    }
    console.error('[assistant/chat] failed', err)
    return new Response('Assistant request failed.', { status: 500 })
  }
}
