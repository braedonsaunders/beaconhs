// Period digest — synthesise many journal entries into a short manager recap.

import { generateText } from 'ai'
import { getModel, type AiConfig } from './client'
import { JOURNAL_SYSTEM } from './prompts'

export type DigestEntry = {
  date: string
  author?: string | null
  site?: string | null
  text: string
}

/** Summarise a batch of journal entries. Null when AI is unconfigured or empty. */
export async function generateDigest(
  config: AiConfig | null | undefined,
  args: { scope?: string; entries: DigestEntry[] },
): Promise<string | null> {
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

  const { text } = await generateText({
    model,
    system: JOURNAL_SYSTEM,
    prompt: `Below are ${args.entries.length} field-safety journal entries. Write a concise ${scope} digest for a safety manager: the main work and themes, anything notable or recurring, and any follow-ups or action items mentioned. 4–8 sentences of plain prose. No preamble and no bullet list.\n\n---\n${corpus}`,
    temperature: 0.4,
  })
  return text.trim()
}
