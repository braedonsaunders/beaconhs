import { z } from 'zod'
import type { Annotation } from '@beaconhs/db/schema'
import { MAX_PHOTO_ANNOTATIONS, photoAnnotationSchema } from '@beaconhs/forms-core'

const photoEdits = z.object({
  caption: z.string().max(1_000),
  annotations: z.array(photoAnnotationSchema).max(MAX_PHOTO_ANNOTATIONS),
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
