// Per-call AI usage metering. Every model resolved through `getModel` with a
// usage sink on its config is wrapped in this middleware, so token counts and
// latency are recorded for generate AND stream calls without touching the call
// sites. The sink decides where the event goes (Admin → AI → Usage).

import type { LanguageModelMiddleware } from 'ai'

export type AiUsageEvent = {
  feature: string
  tier: 'fast' | 'smart'
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
  outcome: 'succeeded' | 'failed'
  error: string | null
}

/** Receives one event per model call. Must not throw; failures are its own concern. */
export type AiUsageSink = (event: AiUsageEvent) => void

type UsageCounts = { inputTokens: number; outputTokens: number }

function countsOf(usage: unknown): UsageCounts {
  const record = (usage ?? {}) as {
    inputTokens?: number | { total?: number }
    outputTokens?: number | { total?: number }
  }
  const total = (value: number | { total?: number } | undefined): number => {
    const n = typeof value === 'number' ? value : value?.total
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0
  }
  return { inputTokens: total(record.inputTokens), outputTokens: total(record.outputTokens) }
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

export function meteringMiddleware(
  sink: AiUsageSink,
  identity: Pick<AiUsageEvent, 'feature' | 'tier' | 'provider' | 'model'>,
): LanguageModelMiddleware {
  const emit = (started: number, counts: UsageCounts, error: unknown | null) => {
    try {
      sink({
        ...identity,
        ...counts,
        latencyMs: Math.max(0, Date.now() - started),
        outcome: error === null ? 'succeeded' : 'failed',
        error: error === null ? null : errorMessage(error),
      })
    } catch {
      // Metering never breaks the model call.
    }
  }
  return {
    specificationVersion: 'v3',
    wrapGenerate: async ({ doGenerate }) => {
      const started = Date.now()
      try {
        const result = await doGenerate()
        emit(started, countsOf(result.usage), null)
        return result
      } catch (error) {
        emit(started, { inputTokens: 0, outputTokens: 0 }, error)
        throw error
      }
    },
    wrapStream: async ({ doStream }) => {
      const started = Date.now()
      let result: Awaited<ReturnType<typeof doStream>>
      try {
        result = await doStream()
      } catch (error) {
        emit(started, { inputTokens: 0, outputTokens: 0 }, error)
        throw error
      }
      let counts: UsageCounts = { inputTokens: 0, outputTokens: 0 }
      let streamError: unknown | null = null
      const metered = result.stream.pipeThrough(
        new TransformStream({
          transform(part, controller) {
            if (part.type === 'finish') counts = countsOf(part.usage)
            if (part.type === 'error') streamError = part.error
            controller.enqueue(part)
          },
          flush() {
            emit(started, counts, streamError)
          },
        }),
      )
      return { ...result, stream: metered }
    },
  }
}
