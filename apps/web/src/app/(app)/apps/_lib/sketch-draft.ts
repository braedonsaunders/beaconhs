import 'server-only'

// AI diagram drafting for `sketch` elements: a natural-language description →
// validated diagram primitives the filler inserts as an editable draft. The AI
// only ever DRAFTS — the primitives open on the canvas for a human to adjust,
// and nothing persists until the user explicitly saves the drawing.

import { runBuilderPrompt, type AiConfig } from '@beaconhs/ai'
import { sketchDraftSchema, type SketchDraftElement } from '@beaconhs/forms-core'

export type SketchDraftResult =
  { ok: true; elements: SketchDraftElement[] } | { ok: false; error: string }

function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fence?.[1] ?? trimmed).trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new Error('no JSON object found')
  return JSON.parse(body.slice(start, end + 1))
}

const SKETCH_DRAFT_SYSTEM = `You draft simple site diagrams as JSON for a drawing canvas. Output a SINGLE JSON object and NOTHING else (no prose, no markdown fences):

type Draft = {
  elements: Array<
    | { kind: "box", x: number, y: number, w: number, h: number, label?: string, shape?: "rect" | "ellipse" | "diamond" }
    | { kind: "arrow", x1: number, y1: number, x2: number, y2: number, label?: string }
    | { kind: "text", x: number, y: number, text: string }
  >
}

Coordinate space: x 0–1200 (left to right), y 0–800 (top to bottom). Boxes need w/h of at least 20. Keep labels short (a few words).

Rules:
- At most 30 elements. Prefer fewer, well-placed shapes over clutter.
- Lay out left-to-right or top-to-bottom in reading order; do not overlap labels.
- Use "ellipse" for rounded items (loads, people), "diamond" for decision/warning points, "rect" otherwise.
- Use arrows to show direction of travel, load paths, or sequence — never crossing through a labeled box when avoidable.
- Ordinary text is for titles and notes only; put item names on the box label instead.
- Output ONLY the JSON object.`

function draftUserPrompt(description: string, symbolNames: string[], lastError: string): string {
  const symbolsLine =
    symbolNames.length > 0
      ? `The user can already one-tap insert these ready-made symbols, so do NOT redraw them — focus the draft on layout, zones, paths, and annotations: ${symbolNames.join(', ')}.`
      : ''
  const retryLine = lastError
    ? `\n\nYour previous reply was rejected (${lastError}). Reply again with a corrected JSON object.`
    : ''
  return `${symbolsLine}\n\nDiagram to draft:\n${description}${retryLine}`
}

function draftRejection(lastError: string): string {
  return `The AI returned an unusable diagram draft: ${lastError}`
}

export async function generateSketchDraft(
  config: AiConfig | null | undefined,
  args: { description: string; symbolNames: string[] },
): Promise<SketchDraftResult> {
  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const userPrompt = draftUserPrompt(args.description, args.symbolNames, lastError)
    const text = await runBuilderPrompt(config, {
      system: SKETCH_DRAFT_SYSTEM,
      prompt: userPrompt,
      tier: 'smart',
    })
    if (!text) {
      return {
        ok: false,
        error: 'AI is not configured for this workspace, or the model did not respond.',
      }
    }
    let json: unknown
    try {
      json = extractJson(text)
    } catch {
      lastError = 'response was not valid JSON'
      continue
    }
    const parsed = sketchDraftSchema.safeParse(json)
    if (parsed.success) return { ok: true, elements: parsed.data.elements }
    lastError = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
  }
  return { ok: false, error: draftRejection(lastError) }
}
