import { sanitizeDocumentHtml } from '@beaconhs/forms-core'

/** Final read-boundary sanitizer for stored rich HTML. */
export function SanitizedRichContent({
  html,
  className,
  allowApplicationImages = false,
}: {
  html: string | null | undefined
  className?: string
  allowApplicationImages?: boolean
}) {
  const clean = sanitizeDocumentHtml(html, { allowApplicationImages })
  if (!clean) return null
  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />
}
