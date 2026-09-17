import type { FeedbackClient, FeedbackClientInput, FeedbackTurnResult } from './types'

export function createHttpFeedbackClient(options: {
  url: string
  fetch?: typeof globalThis.fetch
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>)
}): FeedbackClient {
  const fetchImpl = options.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('Feedback HTTP client requires fetch.')

  return {
    async send(input) {
      const headers = new Headers(
        typeof options.headers === 'function' ? await options.headers() : options.headers,
      )
      if (!headers.has('content-type')) headers.set('content-type', 'application/json')
      const response = await fetchImpl(options.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(toRequestBody(input)),
      })
      const body = await readJson(response)
      if (!response.ok) {
        return {
          kind: 'unavailable',
          message:
            typeof body.message === 'string' && body.message.trim()
              ? body.message
              : 'The report could not be completed. Try again in a moment.',
        }
      }
      return body as FeedbackTurnResult
    },
  }
}

function toRequestBody(input: FeedbackClientInput) {
  return {
    text: input.text,
    context: input.context,
    answers: input.answers,
    forceFile: input.forceFile,
    sessionId: input.sessionId,
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  if (!text) return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { message: text }
  } catch {
    return { message: text }
  }
}
