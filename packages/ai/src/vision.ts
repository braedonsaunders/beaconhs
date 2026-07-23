// Photo intelligence — a factual auto-caption for attached jobsite photos.
// Uses the 'smart' (vision-capable) tier. No hazard detection (HazID owns that).

import { generateObject } from 'ai'
import { z } from 'zod'
import { getModel, type AiConfig } from './client'

export const photoInsightSchema = z.object({
  caption: z.string().describe('One factual sentence describing what the jobsite photo shows'),
})

export type PhotoInsight = z.infer<typeof photoInsightSchema>

export const AI_VISION_LIMITS = {
  images: 4,
  imageBytes: 8 * 1024 * 1024,
  totalImageBytes: 10 * 1024 * 1024,
  promptChars: 4_000,
} as const

export function assertVisionRequest(args: {
  images: readonly Uint8Array[]
  prompt?: string
}): void {
  if (args.images.length === 0 || args.images.length > AI_VISION_LIMITS.images) {
    throw new Error(`AI vision requires between 1 and ${AI_VISION_LIMITS.images} images.`)
  }
  if (args.prompt !== undefined && args.prompt.length > AI_VISION_LIMITS.promptChars) {
    throw new Error(`AI vision prompt exceeds ${AI_VISION_LIMITS.promptChars} characters.`)
  }
  let totalBytes = 0
  for (const image of args.images) {
    if (!(image instanceof Uint8Array) || image.byteLength === 0) {
      throw new Error('AI vision image must contain bytes.')
    }
    if (image.byteLength > AI_VISION_LIMITS.imageBytes) {
      throw new Error(`AI vision image exceeds ${AI_VISION_LIMITS.imageBytes} bytes.`)
    }
    totalBytes += image.byteLength
    if (totalBytes > AI_VISION_LIMITS.totalImageBytes) {
      throw new Error(`AI vision images exceed ${AI_VISION_LIMITS.totalImageBytes} total bytes.`)
    }
  }
}

/**
 * Caption a jobsite photo from storage-validated bytes. Returns null when AI
 * is unconfigured.
 */
export async function describePhoto(
  config: AiConfig | null | undefined,
  args: { image: Uint8Array },
): Promise<PhotoInsight | null> {
  const model = getModel(config, 'smart')
  if (!model) return null
  assertVisionRequest({ images: [args.image] })

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

// --- Safety vision analysis -------------------------------------------------
//
// Construction H&S review of one or more jobsite photos: flags missing/incorrect
// PPE and visible hazards with a severity. Powers AI-enabled Builder photo fields +
// the `analyze_photos` flow action. Uses the smart (vision) tier.

export const visionSeverity = z.enum(['low', 'medium', 'high'])
export type VisionSeverity = z.infer<typeof visionSeverity>

export const safetyVisionSchema = z.object({
  summary: z
    .string()
    .describe(
      'One or two factual sentences describing the photo from a health & safety standpoint',
    ),
  overallRisk: z
    .enum(['none', 'low', 'medium', 'high'])
    .describe('Overall risk level visible in the photo — "none" if nothing of concern is visible'),
  ppe: z
    .array(
      z.object({
        item: z
          .string()
          .describe(
            'PPE item, e.g. "hard hat", "hi-vis vest", "eye protection", "gloves", "fall harness"',
          ),
        status: z
          .enum(['present', 'missing', 'incorrect'])
          .describe('Whether this PPE is correctly worn, missing, or worn incorrectly'),
        detail: z
          .string()
          .nullable()
          .describe(
            'Short note locating the observation, e.g. "worker on the right has no hard hat"',
          ),
      }),
    )
    .max(12)
    .describe(
      'PPE observations for people visible in the photo. Empty when no people are visible.',
    ),
  hazards: z
    .array(
      z.object({
        type: z
          .string()
          .describe(
            'Hazard category, e.g. "working at height", "trip hazard", "exposed edge", "electrical", "housekeeping"',
          ),
        severity: visionSeverity,
        detail: z.string().describe('What was observed and where in the photo'),
      }),
    )
    .max(12)
    .describe('Hazards / unsafe conditions clearly visible in the photo'),
})

export type SafetyVisionAnalysis = z.infer<typeof safetyVisionSchema>

const SAFETY_VISION_PROMPT = `You are an experienced construction health & safety inspector reviewing jobsite photo(s).
Report only what is CLEARLY VISIBLE — never speculate about what might be out of frame.

1. PPE: for each person visible, assess required PPE (hard hat, hi-vis, eye protection, gloves, appropriate footwear, and fall protection when working at height). Mark each as present, missing, or incorrect, and say which person.
2. Hazards: identify unsafe conditions (unprotected work at height, trip/slip hazards, exposed edges/openings, poor housekeeping, electrical, struck-by, etc.) with a severity.

If no people are visible, return an empty ppe list. If nothing of concern is visible, return empty hazards and overallRisk "none". Set overallRisk to the highest individual concern.`

/**
 * Review storage-validated jobsite photo bytes for missing PPE + hazards.
 * Returns null when AI is unconfigured or no images are supplied.
 */
export async function runVisionAnalysis(
  config: AiConfig | null | undefined,
  args: { images: Uint8Array[]; prompt?: string },
): Promise<SafetyVisionAnalysis | null> {
  if (!args.images || args.images.length === 0) return null
  const model = getModel(config, 'smart')
  if (!model) return null
  assertVisionRequest(args)

  const { object } = await generateObject({
    model,
    schema: safetyVisionSchema,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: args.prompt ?? SAFETY_VISION_PROMPT },
          ...args.images.map((image) => ({ type: 'image' as const, image })),
        ],
      },
    ],
    temperature: 0.2,
  })
  return object
}
