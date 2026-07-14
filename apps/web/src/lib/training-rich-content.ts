import { sanitizeDocumentHtml } from '@beaconhs/forms-core'

/** Training prose may embed only server-minted, same-origin attachment images. */
export function sanitizeTrainingHtml(html: string | null | undefined): string {
  return sanitizeDocumentHtml(html, { allowApplicationImages: true })
}
