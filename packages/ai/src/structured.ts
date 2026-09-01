// Portable structured generation. `generateObject` needs provider
// `responseFormat` / structuredOutputs — OpenRouter + Kimi (and several other
// compatible models) reject that and return free-form JSON that fails the
// schema. generateText + parse + Zod works for every provider Test connection
// already proved.

import { generateText, type LanguageModel } from 'ai'
import type { z } from 'zod'

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] ?? trimmed).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Model reply did not contain a JSON object.')
  return JSON.parse(candidate.slice(start, end + 1)) as unknown
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

const SENTIMENT_LABELS = new Set(['positive', 'steady', 'mixed', 'concerned', 'negative'])
const SEVERITIES = new Set(['low', 'medium', 'high'])

/** Map the field names models invent from the prompt onto the stored schema. */
export function coerceJournalAnalysis(raw: unknown): unknown {
  const object = asRecord(raw)
  if (!object) return raw
  const sentimentRaw = asRecord(object.sentiment) ?? asRecord(object.overall_sentiment)
  const themesRaw = object.themes ?? object.recurring_themes
  const issuesRaw = object.issues ?? object.concrete_issues
  const actionsRaw = object.actions ?? object.recommended_actions
  const summary =
    typeof object.summary === 'string'
      ? object.summary
      : typeof object.note === 'string'
        ? object.note
        : typeof sentimentRaw?.assessment === 'string'
          ? sentimentRaw.assessment
          : undefined

  const label = String(sentimentRaw?.label ?? '')
  const drivers = Array.isArray(sentimentRaw?.drivers)
    ? sentimentRaw.drivers.filter((item): item is string => typeof item === 'string').join(' ')
    : ''
  const sentiment = sentimentRaw
    ? {
        label: SENTIMENT_LABELS.has(label) ? label : 'mixed',
        score: typeof sentimentRaw.score === 'number' ? sentimentRaw.score : 0,
        rationale:
          typeof sentimentRaw.rationale === 'string'
            ? sentimentRaw.rationale
            : drivers ||
              (typeof sentimentRaw.assessment === 'string'
                ? sentimentRaw.assessment
                : 'See the summary.'),
      }
    : undefined

  const themes = Array.isArray(themesRaw)
    ? themesRaw
        .map((item) => {
          if (typeof item === 'string') return { label: item, count: 1 }
          const row = asRecord(item)
          if (!row) return null
          const themeLabel = String(row.label ?? row.theme ?? '').trim()
          if (!themeLabel) return null
          return { label: themeLabel, count: Math.max(1, Number(row.count) || 1) }
        })
        .filter((item) => item !== null)
    : undefined

  const issues = Array.isArray(issuesRaw)
    ? issuesRaw
        .map((item) => {
          const row = asRecord(item)
          if (!row) return null
          const title = String(row.title ?? row.issue ?? '').trim()
          if (!title) return null
          const severity = String(row.severity ?? '')
          return {
            title,
            severity: SEVERITIES.has(severity) ? severity : 'medium',
            detail: String(row.detail ?? row.evidence ?? row.risk ?? ''),
            site: row.site == null || row.site === '' ? null : String(row.site),
          }
        })
        .filter((item) => item !== null)
    : undefined

  const actions = Array.isArray(actionsRaw)
    ? actionsRaw
        .map((item) => {
          const row = asRecord(item)
          if (!row) return null
          const action = String(row.action ?? '').trim()
          if (!action) return null
          const priority = String(row.priority ?? '')
          return {
            action,
            owner: String(row.owner ?? 'Supervisor'),
            priority: SEVERITIES.has(priority) ? priority : 'medium',
            rationale: String(row.rationale ?? row.addresses ?? ''),
          }
        })
        .filter((item) => item !== null)
    : undefined

  return { summary, sentiment, themes, issues, actions }
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
