// The agentic turn endpoint. Streams a multi-step tool-using assistant turn over
// the UI-message protocol (decoded client-side by readUIMessageStream) and
// persists the assembled transcript into ai_messages on finish.
//
// Mirrors the contract of journals/ai/route.ts but for a full agent loop.

import { convertToModelMessages, type UIMessage } from 'ai'
import { runAgentTurn, AIDisabledError } from '@beaconhs/ai'
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
    if ((await resolveConversationAccess(conversationId)) !== 'owner') {
      return new Response('Forbidden', { status: 403 })
    }
  } else {
    conversationId = await createConversation({ scope: SCOPE, title: prompt.slice(0, 60) })
  }

  // Persist the user message FIRST so a dropped connection never loses the turn.
  await appendMessage({ conversationId, role: 'user', content: prompt })

  const aiConfig = await getTenantAiConfig(ctx)
  const tools = buildToolRegistry(ctx)

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
          data: { v: 1, kind: 'agent-turn', finishReason, aborted, usage, parts },
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
