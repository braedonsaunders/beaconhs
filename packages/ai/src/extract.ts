// Structured metadata extraction from an entry's text — drives the AI summary
// and auto-tags (the "smart tree"). No hazard detection — that lives in HazID.

import { generateObject } from 'ai'
import { z } from 'zod'
import { getModel, type AiConfig } from './client'
import { JOURNAL_SYSTEM } from './prompts'

export const entryMetaSchema = z.object({
  summary: z.string().describe('One short paragraph, plain language, recapping the entry'),
  tags: z
    .array(z.string())
    .describe(
      'Between 3 and 8 short lowercase topic tags, e.g. "scaffolding", "traffic control", "concrete pour". No punctuation.',
    ),
})

export type EntryMeta = z.infer<typeof entryMetaSchema>

/** Extract summary + tags from entry plaintext. Null when AI is unconfigured or text is too short. */
export async function extractEntryMeta(
  config: AiConfig | null | undefined,
  bodyText: string,
): Promise<EntryMeta | null> {
  const model = getModel(config, 'fast')
  if (!model) return null
  const text = bodyText.trim()
  if (text.length < 12) return null

  const { object } = await generateObject({
    model,
    schema: entryMetaSchema,
    system: JOURNAL_SYSTEM,
    prompt: `Read this daily field-safety journal entry and extract a one-paragraph summary and topic tags. Use only information present in the text.\n\n---\n${text}`,
    temperature: 0.2,
  })
  const tags = Array.from(
    new Set(object.tags.map((t) => t.trim().toLowerCase()).filter(Boolean)),
  ).slice(0, 8)
  return { ...object, tags }
}
