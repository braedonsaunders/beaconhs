// Bulk analysis of many journal entries — overall sentiment, the issues/risks
// the journals surface, and recommended corrective actions routed to the right
// owner. Powers the Insights "AI journal analysis" widget. This is the richer,
// structured counterpart to the short prose `generateDigest`.

import { generateObject } from 'ai'
import { z } from 'zod'
import { getModel, type AiConfig } from './client'
import { JOURNAL_SYSTEM } from './prompts'
import type { DigestEntry } from './digest'

export const journalAnalysisSchema = z.object({
  summary: z.string().describe('2–3 sentence plain-language recap for a safety manager.'),
  sentiment: z
    .object({
      label: z
        .enum(['positive', 'steady', 'mixed', 'concerned', 'negative'])
        .describe('Overall tone / crew morale across the entries.'),
      score: z.number().min(-1).max(1).describe('-1 very negative … 0 neutral … 1 very positive.'),
      rationale: z.string().describe('One sentence on what drove the sentiment.'),
    })
    .describe('Overall sentiment of the journals in this period.'),
  themes: z
    .array(z.object({ label: z.string(), count: z.number().int().min(1) }))
    .max(8)
    .describe('Recurring topics / themes, most frequent first.'),
  issues: z
    .array(
      z.object({
        title: z.string().describe('Short title for the surfaced issue or risk.'),
        severity: z.enum(['low', 'medium', 'high']),
        detail: z.string().describe('1–2 sentences of context, grounded in the entries.'),
        site: z.string().nullable().describe('Site name if the issue is site-specific, else null.'),
      }),
    )
    .max(8)
    .describe('Problems, risks or recurring concerns surfaced by the journals.'),
  actions: z
    .array(
      z.object({
        action: z.string().describe('A concrete recommended corrective action.'),
        owner: z
          .string()
          .describe(
            'Who should own it — a named person or role drawn from the entries (e.g. a named supervisor or the site lead), so it reaches the right people.',
          ),
        priority: z.enum(['low', 'medium', 'high']),
        rationale: z.string().describe('Why this action, tied to a surfaced issue.'),
      }),
    )
    .max(6)
    .describe('Recommended corrective actions, each routed to the most appropriate owner.'),
})

export type JournalAnalysis = z.infer<typeof journalAnalysisSchema>

// --- Generic dataset analysis (Insights AI cards) ---------------------------

export const datasetAnalysisSchema = z.object({
  summary: z.string().describe('2–3 sentence plain-language takeaway, grounded in the data.'),
  points: z
    .array(
      z.object({
        title: z.string().describe('Short headline for the finding.'),
        detail: z.string().describe('1–2 sentences of supporting detail, grounded in the data.'),
        tone: z
          .enum(['positive', 'neutral', 'watch', 'negative'])
          .describe('Sentiment / urgency of this finding.'),
      }),
    )
    .max(8)
    .describe('Key findings / insights, most important first. Returning fewer is fine.'),
})

export type DatasetAnalysis = z.infer<typeof datasetAnalysisSchema>

function cell(v: unknown): string {
  if (v === null || typeof v === 'undefined') return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v).replace(/\n/g, ' ').slice(0, 120)
}

/** Analyse an arbitrary query result (an Insights AI card) under a user-supplied
 *  instruction. The data is a normal BHQL result, so AI cards are fully
 *  user-buildable. Null when AI is unconfigured or there are no rows. */
export async function analyseDataset(
  config: AiConfig | null | undefined,
  args: {
    instruction: string
    columns: { key: string; label: string }[]
    rows: Record<string, unknown>[]
  },
): Promise<DatasetAnalysis | null> {
  const model = getModel(config, 'smart')
  if (!model || args.rows.length === 0 || args.columns.length === 0) return null
  const cols = args.columns
  const header = cols.map((c) => c.label).join(' | ')
  const sep = cols.map(() => '---').join(' | ')
  const body = args.rows
    .slice(0, 500)
    .map((r) => cols.map((c) => cell(r[c.key])).join(' | '))
    .join('\n')

  const { object } = await generateObject({
    model,
    schema: datasetAnalysisSchema,
    system:
      'You are a meticulous EHS / operations data analyst. Analyse the dataset and follow the user instruction. Ground every statement STRICTLY in the data provided — never invent numbers, names or events. If the data is thin, say so and return fewer findings.',
    prompt: `Instruction: ${args.instruction}\n\nDataset (${args.rows.length} rows shown${args.rows.length > 500 ? ', truncated to 500' : ''}):\n${header}\n${sep}\n${body}`,
    temperature: 0.2,
  })
  return object
}

/** Analyse a batch of journal entries. Null when AI is unconfigured or empty. */
export async function analyseJournals(
  config: AiConfig | null | undefined,
  args: { scope?: string; entries: DigestEntry[] },
): Promise<JournalAnalysis | null> {
  const model = getModel(config, 'smart')
  if (!model || args.entries.length === 0) return null
  const scope = args.scope ?? 'recent'
  const corpus = args.entries
    .slice(0, 200)
    .map(
      (e) =>
        `- [${e.date}${e.site ? ` · ${e.site}` : ''}${e.author ? ` · ${e.author}` : ''}] ${e.text}`,
    )
    .join('\n')

  const { object } = await generateObject({
    model,
    schema: journalAnalysisSchema,
    system: JOURNAL_SYSTEM,
    prompt: `You are analysing ${args.entries.length} field-safety journal entries from the ${scope} period. Produce a structured analysis for a safety manager:
- the overall sentiment / crew morale and what drives it,
- the recurring themes,
- the concrete issues, risks or concerns the journals surface,
- and recommended corrective actions, each assigned to the most appropriate owner (name the specific person or role from the entries wherever possible) so the recommendation reaches the right people.
Ground every claim in the entries — do not invent incidents. If little is surfaced, return fewer items rather than padding.

---
${corpus}`,
    temperature: 0.3,
  })
  return object
}
