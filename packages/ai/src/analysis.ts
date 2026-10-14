// Ad-hoc dataset analysis for Insights AI cards: a BHQL result analysed under
// the card's own instruction. Scheduled, cited analyses live in @beaconhs/briefs.

import { z } from 'zod'
import { getModel, type AiConfig } from './client'
import { generateStructured } from './structured'

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
  const model = getModel(config, 'smart', 'insights.card')
  if (!model || args.rows.length === 0 || args.columns.length === 0) return null
  const cols = args.columns
  const header = cols.map((c) => c.label).join(' | ')
  const sep = cols.map(() => '---').join(' | ')
  const body = args.rows
    .slice(0, 500)
    .map((r) => cols.map((c) => cell(r[c.key])).join(' | '))
    .join('\n')

  return generateStructured({
    model,
    schema: datasetAnalysisSchema,
    system:
      'You are a meticulous EHS / operations data analyst. Analyse the dataset and follow the user instruction. Ground every statement STRICTLY in the data provided — never invent numbers, names or events. If the data is thin, say so and return fewer findings.',
    prompt: `Instruction: ${args.instruction}\n\nReturn JSON with keys summary (string) and points (array of {title, detail, tone} where tone is positive|neutral|watch|negative).\n\nDataset (${args.rows.length} rows shown${args.rows.length > 500 ? ', truncated to 500' : ''}):\n${header}\n${sep}\n${body}`,
    temperature: 0.2,
  })
}
