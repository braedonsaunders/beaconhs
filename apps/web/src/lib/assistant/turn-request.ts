import { MAX_ASSISTANT_PROMPT_CHARS } from './limits'
import { isUuid } from '../list-params'

// Shape validation for an assistant turn POST body, kept pure so it can be
// exercised directly. The route only maps the result onto a Response.
//
// `reason` is the HTTP reason phrase, never UI copy — it is not translated and
// never reaches a person, so it deliberately avoids the `message` property name
// the i18n runtime audit treats as user-facing.

type AssistantTurnRequest = {
  /** null = start a new conversation. */
  conversationId: string | null
  prompt: string
}

type AssistantTurnRequestResult =
  { ok: true; request: AssistantTurnRequest } | { ok: false; status: 400 | 413; reason: string }

/**
 * Parse the turn body.
 *
 * `conversationId` is optional and **null is equivalent to absent** — a client
 * that has not created a conversation yet necessarily sends null, because
 * JSON.stringify drops undefined properties but serializes null. Rejecting a
 * present-but-null id 400'd every first message in a new chat.
 */
export function parseAssistantTurnRequest(body: unknown): AssistantTurnRequestResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, reason: 'Bad request' }
  }
  const input = body as { conversationId?: unknown; prompt?: unknown }

  const conversationId = input.conversationId ?? null
  if (conversationId !== null && typeof conversationId !== 'string') {
    return { ok: false, status: 400, reason: 'Bad request' }
  }
  // An id that IS supplied must be a real one; a blank string is a client bug,
  // not a request to start a new conversation.
  if (conversationId !== null && !isUuid(conversationId)) {
    return { ok: false, status: 400, reason: 'Bad request' }
  }

  if (typeof input.prompt !== 'string') {
    return { ok: false, status: 400, reason: 'Invalid prompt' }
  }
  if (input.prompt.length > MAX_ASSISTANT_PROMPT_CHARS) {
    return { ok: false, status: 413, reason: 'Prompt too large' }
  }
  const prompt = input.prompt.trim()
  if (!prompt) return { ok: false, status: 400, reason: 'Empty prompt' }

  return { ok: true, request: { conversationId, prompt } }
}
