// The agentic turn endpoint. Streams a multi-step tool-using assistant turn over
// the UI-message protocol (decoded client-side by readUIMessageStream) and
// persists the assembled transcript into ai_messages on finish.
//
// Mirrors the contract of journals/ai/route.ts but for a full agent loop.

import { convertToModelMessages, type UIMessage } from 'ai'
import {
  runAgentTurn,
  AIDisabledError,
  getModel,
  providerSupportsImageToolResults,
} from '@beaconhs/ai'
import { can } from '@beaconhs/tenant'
import { getRequestContext } from '@/lib/auth'
import { getTenantAiConfig } from '@/lib/ai-config'
import {
  appendMessage,
  createConversation,
  getConversationMessagePage,
  resolveConversationAccess,
} from '@/lib/ai-conversations'
import { buildToolRegistry } from '@/lib/assistant/registry'
import { assistantSystemPrompt } from '@/lib/assistant/system-prompt'
import { MAX_ASSISTANT_PROMPT_CHARS, MAX_ASSISTANT_REQUEST_BYTES } from '@/lib/assistant/limits'
import {
  readBoundedJsonBody,
  RequestBodyLengthError,
  RequestBodyParseError,
  RequestBodyTimeoutError,
  RequestBodyTooLargeError,
} from '@/lib/request-body'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'
// Agent turns run a multi-step tool loop — far longer than a single completion.
export const maxDuration = 300

const SCOPE = 'assistant'
const REQUEST_TIMEOUT_MS = 15_000

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

function conversationResponse(
  body: BodyInit | null,
  status: number,
  conversationId: string | null,
): Response {
  const headers = new Headers()
  if (conversationId) headers.set('x-conversation-id', conversationId)
  return new Response(body, { status, headers })
}

const TURN_FAILURE_MESSAGE = 'The assistant could not complete this response. Please try again.'

async function persistFailedTurn(conversationId: string): Promise<void> {
  try {
    await appendMessage({
      conversationId,
      role: 'assistant',
      content: TURN_FAILURE_MESSAGE,
      data: {
        v: 1,
        kind: 'agent-turn',
        status: 'failed',
        finishReason: 'error',
        aborted: false,
        parts: [{ type: 'text', text: TURN_FAILURE_MESSAGE }],
      },
    })
  } catch (error) {
    console.error('[assistant/chat] failed to persist terminal error state', error)
  }
}

export async function POST(req: Request): Promise<Response> {
  const ctx = await getRequestContext()
  if (!ctx) return new Response('Unauthorized', { status: 401 })
  if (!can(ctx, 'assistant.use')) return new Response('Forbidden', { status: 403 })

  let body: unknown
  try {
    body = await readBoundedJsonBody(req, {
      maxBytes: MAX_ASSISTANT_REQUEST_BYTES,
      timeoutMs: REQUEST_TIMEOUT_MS,
    })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return new Response('Request too large', { status: 413 })
    }
    if (error instanceof RequestBodyTimeoutError) {
      return new Response('Request timed out', { status: 408 })
    }
    if (error instanceof RequestBodyLengthError || error instanceof RequestBodyParseError) {
      return new Response('Bad request', { status: 400 })
    }
    return new Response('Bad request', { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return new Response('Bad request', { status: 400 })
  }
  const input = body as { conversationId?: unknown; prompt?: unknown }
  if (input.conversationId !== undefined && typeof input.conversationId !== 'string') {
    return new Response('Bad request', { status: 400 })
  }
  if (typeof input.prompt !== 'string') return new Response('Invalid prompt', { status: 400 })
  if (input.prompt.length > MAX_ASSISTANT_PROMPT_CHARS) {
    return new Response('Prompt too large', { status: 413 })
  }
  const prompt = input.prompt.trim()
  if (!prompt) return new Response('Empty prompt', { status: 400 })

  // Resolve / create the conversation. Only the OWNER may send a turn.
  let conversationId = input.conversationId ?? null
  if (conversationId) {
    if (!isUuid(conversationId)) return new Response('Bad request', { status: 400 })
    if ((await resolveConversationAccess(conversationId, SCOPE)) !== 'owner') {
      return new Response('Forbidden', { status: 403 })
    }
  }

  const aiConfig = await getTenantAiConfig(ctx)
  // Resolve provider/model readiness before creating a thread. A disabled or
  // incomplete configuration must not leave an unreachable user-only chat.
  if (!getModel(aiConfig, 'smart')) {
    return conversationResponse('AI is not configured for this workspace.', 503, conversationId)
  }
  // Vision tools (rendered scanned-PDF pages) are only exposed when the provider
  // accepts image content in a tool result — currently Anthropic.
  const tools = buildToolRegistry(ctx, {
    imageToolResults: providerSupportsImageToolResults(aiConfig),
  })
  const system = assistantSystemPrompt({
    orgName: aiConfig?.org?.name ?? null,
    userName: ctx.membership?.displayName ?? null,
    today: new Date().toISOString().slice(0, 10),
    canWrite: can(ctx, 'assistant.write'),
  })

  if (!conversationId) {
    conversationId = await createConversation({ scope: SCOPE, title: prompt.slice(0, 60) })
  }
  let userPersisted = false
  try {
    // Persist first so a dropped connection cannot lose a turn that actually started.
    await appendMessage({ conversationId, role: 'user', content: prompt })
    userPersisted = true

    // Fetch exactly the recent model window in SQL; never materialize the full transcript.
    const history = (await getConversationMessagePage({ conversationId })).items
    const uiMessages = history.map((message) => ({
      role: message.role,
      parts:
        message.data &&
        Array.isArray((message.data as { parts?: unknown }).parts) &&
        (message.data as { parts: unknown[] }).parts.length > 0
          ? ((message.data as { parts: unknown }).parts as UIMessage['parts'])
          : ([{ type: 'text', text: message.content }] as UIMessage['parts']),
    }))

    let modelMessages
    try {
      modelMessages = await convertToModelMessages(uiMessages, {
        tools,
        ignoreIncompleteToolCalls: true,
      })
    } catch {
      // Fall back to plain text if an older persisted tool part is no longer convertible.
      modelMessages = await convertToModelMessages(
        history.map((message) => ({
          role: message.role,
          parts: [{ type: 'text', text: message.content }],
        })),
        { ignoreIncompleteToolCalls: true },
      )
    }

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
        const fallback = aborted
          ? 'Response stopped.'
          : finishReason === 'error'
            ? TURN_FAILURE_MESSAGE
            : ''
        const content = text || fallback
        const persistedParts = parts.length
          ? stripVisionImages(parts)
          : content
            ? ([{ type: 'text', text: content }] as UIMessage['parts'])
            : []
        await appendMessage({
          conversationId: conversationId!,
          role: 'assistant',
          content,
          data: {
            v: 1,
            kind: 'agent-turn',
            status: aborted ? 'stopped' : finishReason === 'error' ? 'failed' : 'complete',
            finishReason,
            aborted,
            usage,
            parts: persistedParts,
          },
        })
      },
    })

    // Surface the (possibly new) conversation id to the client.
    const headers = new Headers(res.headers)
    headers.set('x-conversation-id', conversationId)
    return new Response(res.body, { status: res.status, headers })
  } catch (err) {
    if (userPersisted) await persistFailedTurn(conversationId)
    if (err instanceof AIDisabledError) {
      return conversationResponse('AI is not configured for this workspace.', 503, conversationId)
    }
    console.error('[assistant/chat] failed', err)
    return conversationResponse('Assistant request failed.', 500, conversationId)
  }
}
