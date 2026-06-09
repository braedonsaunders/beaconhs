// AI builder generation — turns a natural-language prompt into structured JSON
// (a form/App schema, or an automation/Flow graph) for the visual Builder.
//
// Generic on purpose: this package stays decoupled from @beaconhs/forms-core.
// The caller supplies the `system` spec (schema shape + field catalogue + an
// example) and validates the returned text against the forms-core zod schemas,
// retrying with the validation error on failure.

import { generateText } from 'ai'
import { getModel, type AiConfig, type ModelTier } from './client'

export async function runBuilderPrompt(
  config: AiConfig | null | undefined,
  args: { system: string; prompt: string; tier?: ModelTier },
): Promise<string | null> {
  const model = getModel(config, args.tier ?? 'smart')
  if (!model) return null
  try {
    const { text } = await generateText({
      model,
      system: args.system,
      prompt: args.prompt,
    })
    return text
  } catch (e) {
    console.warn('[ai/builder] generation failed:', e instanceof Error ? e.message : e)
    return null
  }
}
