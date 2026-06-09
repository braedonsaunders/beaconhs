// Photo intelligence — a factual auto-caption for attached jobsite photos.
// Uses the 'smart' (vision-capable) tier. No hazard detection (HazID owns that).

import { generateObject } from 'ai'
import { z } from 'zod'
import { getModel, type AiConfig } from './client'

export const photoInsightSchema = z.object({
  caption: z
    .string()
    .describe('One factual sentence describing what the jobsite photo shows'),
})

export type PhotoInsight = z.infer<typeof photoInsightSchema>

/**
 * Caption a jobsite photo. `image` may be a public URL, a data: URL, or raw
 * bytes. Returns null when AI is unconfigured.
 */
export async function describePhoto(
  config: AiConfig | null | undefined,
  args: { image: string | URL | Uint8Array },
): Promise<PhotoInsight | null> {
  const model = getModel(config, 'smart')
  if (!model) return null

  const { object } = await generateObject({
    model,
    schema: photoInsightSchema,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Write a one-sentence factual caption for this construction/industrial jobsite photo attached to a daily work journal. Describe what is shown; do not speculate.',
          },
          { type: 'image', image: args.image },
        ],
      },
    ],
    temperature: 0.2,
  })
  return object
}
