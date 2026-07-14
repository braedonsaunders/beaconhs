import { expandRepeatMarkers, sanitizeEmailHtml } from '@beaconhs/email-render'

/** Sanitize editable template source once, then expand safe repeating-row markers for delivery. */
export function compileBuilderHtml(sourceHtml: string): {
  html: string
  sanitizedSource: string
  errors: string[]
} {
  if (!sourceHtml.trim()) return { html: '', sanitizedSource: '', errors: [] }
  try {
    const sanitizedSource = sanitizeEmailHtml(sourceHtml)
    return { html: expandRepeatMarkers(sanitizedSource), sanitizedSource, errors: [] }
  } catch (e) {
    return {
      html: '',
      sanitizedSource: '',
      errors: [e instanceof Error ? e.message : String(e)],
    }
  }
}
