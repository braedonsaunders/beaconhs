// Portable structured generation. `generateObject` needs provider
// `responseFormat` / structuredOutputs — OpenRouter + Kimi (and several other
// compatible models) reject that and return free-form JSON that fails the
// schema. generateText + parse + Zod works for every provider Test connection
// already proved.

import { generateText, type LanguageModel } from 'ai'
import type { z } from 'zod'

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim()
  const opening = trimmed.indexOf('```')
  const closing = opening < 0 ? -1 : trimmed.indexOf('```', opening + 3)
  let candidate = opening >= 0 && closing >= 0 ? trimmed.slice(opening + 3, closing) : trimmed
  if (opening >= 0 && closing >= 0 && candidate.slice(0, 4).toLowerCase() === 'json')
    candidate = candidate.slice(4)
  candidate = candidate.trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Model reply did not contain a JSON object.')
  return JSON.parse(candidate.slice(start, end + 1)) as unknown
}

export async function generateStructured<T>(args: {
  model: LanguageModel
  schema: z.ZodType<T>
  system: string
  prompt: string
  temperature?: number
  coerce?: (raw: unknown) => unknown
}): Promise<T | null> {
  const { text } = await generateText({
    model: args.model,
    system: `${args.system}

Reply with a single JSON object only — no markdown fences, no prose outside the object.`,
    prompt: args.prompt,
    temperature: args.temperature ?? 0.2,
  })
  let parsed: unknown
  try {
    parsed = extractJsonObject(text)
  } catch {
    return null
  }
  const coerced = args.coerce ? args.coerce(parsed) : parsed
  const result = args.schema.safeParse(coerced)
  return result.success ? result.data : null
}
