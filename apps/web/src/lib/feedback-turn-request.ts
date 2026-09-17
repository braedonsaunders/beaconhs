import { isUuid } from './list-params'

const MAX_FEEDBACK_TEXT_CHARS = 4_000
export const MAX_FEEDBACK_REQUEST_BYTES = 32 * 1024

type FeedbackTurnRequest = {
  text: string
  pathname: string
  pageTitle?: string
  answers: Record<string, string>
  forceFile: boolean
  includePage: boolean
  sessionId: string | null
}

type FeedbackTurnRequestResult =
  { ok: true; request: FeedbackTurnRequest } | { ok: false; status: 400 | 413; reason: string }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asAnswers(value: unknown): Record<string, string> {
  const record = asRecord(value)
  if (!record) return {}
  const answers: Record<string, string> = {}
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === 'string' && item.trim()) answers[key] = item.trim()
  }
  return answers
}

export function parseFeedbackTurnRequest(body: unknown): FeedbackTurnRequestResult {
  const input = asRecord(body)
  if (!input) return { ok: false, status: 400, reason: 'Bad request' }

  if (typeof input.text !== 'string') return { ok: false, status: 400, reason: 'Invalid report' }
  if (input.text.length > MAX_FEEDBACK_TEXT_CHARS) {
    return { ok: false, status: 413, reason: 'Report too large' }
  }
  const text = input.text.trim()
  if (!text) return { ok: false, status: 400, reason: 'Invalid report' }

  const context = asRecord(input.context)
  const pathname = typeof context?.pathname === 'string' ? context.pathname : '/'
  const pageTitle = typeof context?.pageTitle === 'string' ? context.pageTitle : undefined
  const sessionId = input.sessionId ?? null
  if (sessionId !== null && (typeof sessionId !== 'string' || !isUuid(sessionId))) {
    return { ok: false, status: 400, reason: 'Bad request' }
  }

  return {
    ok: true,
    request: {
      text,
      pathname,
      pageTitle,
      answers: asAnswers(input.answers),
      forceFile: input.forceFile === true,
      includePage: input.includePage !== false,
      sessionId,
    },
  }
}
