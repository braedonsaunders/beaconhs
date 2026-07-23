import { z } from 'zod'
import type { Annotation } from '@beaconhs/db/schema'

const point = z.tuple([
  z.number().finite().min(0).max(1_000),
  z.number().finite().min(0).max(1_000),
])
const color = z.string().regex(/^#[0-9a-f]{6}$/iu)
const width = z.number().finite().min(1).max(50)

const annotation = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('arrow'),
    from: point,
    to: point,
    color,
    width,
  }),
  z.object({
    type: z.literal('circle'),
    cx: z.number().finite().min(0).max(1_000),
    cy: z.number().finite().min(0).max(1_000),
    r: z.number().finite().min(0).max(1_500),
    color,
    width,
  }),
  z.object({
    type: z.literal('rect'),
    x: z.number().finite().min(0).max(1_000),
    y: z.number().finite().min(0).max(1_000),
    w: z.number().finite().min(0).max(1_000),
    h: z.number().finite().min(0).max(1_000),
    color,
    width,
  }),
  z.object({
    type: z.literal('text'),
    x: z.number().finite().min(0).max(1_000),
    y: z.number().finite().min(0).max(1_000),
    text: z.string().max(500),
    color,
    size: z.number().finite().min(4).max(200),
  }),
  z.object({
    type: z.literal('free'),
    points: z.array(point).min(1).max(5_000),
    color,
    width,
  }),
])

const photoEdits = z.object({
  caption: z.string().max(1_000),
  annotations: z.array(annotation).max(200),
})

export function parsePhotoEdits(input: unknown): {
  caption: string | null
  annotations: Annotation[] | null
} {
  const parsed = photoEdits.parse(input)
  const caption = parsed.caption.trim()
  return {
    caption: caption || null,
    annotations: parsed.annotations.length > 0 ? (parsed.annotations as Annotation[]) : null,
  }
}
