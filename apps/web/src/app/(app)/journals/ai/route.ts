// Streaming writing-assist endpoint. The editor POSTs { mode, text, tone? } and
// reads back a plain text stream, appending tokens live. Auth-gated to the
// active tenant; returns 503 when AI is disabled so the UI can fall back.

import { isWritingMode, streamWritingAssist, AIDisabledError } from '@beaconhs/ai'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { getTenantAiConfig } from '@/lib/ai-config'
import { parseJournalAiTextInput } from '@/lib/journal-ai-policy'
import {
  readBoundedJsonBody,
  RequestBodyLengthError,
  RequestBodyParseError,
  RequestBodyTimeoutError,
  RequestBodyTooLargeError,
} from '@/lib/request-body'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const MAX_REQUEST_BYTES = 64 * 1024
const REQUEST_TIMEOUT_MS = 15_000

export async function POST(req: Request): Promise<Response> {
  const ctx = await requireRequestContext().catch(() => null)
  if (!ctx) return new Response('Unauthorized', { status: 401 })
  if (
    !ctx.isSuperAdmin &&
    !can(ctx, 'journals.create') &&
    !can(ctx, 'journals.update.own') &&
    !can(ctx, 'journals.assign')
  ) {
    return new Response('Forbidden', { status: 403 })
  }

  let body: unknown
  try {
    body = await readBoundedJsonBody(req, {
      maxBytes: MAX_REQUEST_BYTES,
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
  const b = body as Record<string, unknown>
  const mode = typeof b.mode === 'string' ? b.mode : ''
  if (!isWritingMode(mode)) return new Response('Invalid mode', { status: 400 })
  const parsed = parseJournalAiTextInput(body)
  if (!parsed.ok) return new Response(parsed.error, { status: 400 })

  const aiConfig = await getTenantAiConfig(ctx)
  try {
    return streamWritingAssist(aiConfig, { mode, ...parsed.value })
  } catch (err) {
    if (err instanceof AIDisabledError) return new Response('AI is not configured', { status: 503 })
    return new Response('AI request failed', { status: 500 })
  }
}
