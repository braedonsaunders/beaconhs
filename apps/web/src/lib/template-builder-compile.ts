import {
  expandRepeatMarkers,
  findTableStructureBlockHelpers,
  sanitizeEmailHtml,
} from '@beaconhs/email-render'

/** Sanitize editable template source once, then expand safe repeating-row markers for delivery. */
export function compileBuilderHtml(sourceHtml: string): {
  html: string
  sanitizedSource: string
  errors: string[]
} {
  if (!sourceHtml.trim()) return { html: '', sanitizedSource: '', errors: [] }
  // Checked on the raw source: sanitizing parses the HTML and would silently
  // hoist these out of the table, doubling the row's cells.
  const stray = findTableStructureBlockHelpers(sourceHtml)
  if (stray.length > 0)
    return {
      html: '',
      sanitizedSource: '',
      errors: [
        `${stray[0]} sits between table cells, where it cannot be kept. Put it inside a cell, or use a row with data-if / data-each.`,
      ],
    }
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
