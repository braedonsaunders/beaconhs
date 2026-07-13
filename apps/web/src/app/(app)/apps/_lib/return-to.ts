const UUID_SEGMENT = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const HAZARD_ASSESSMENT_RETURN = new RegExp(
  `^/hazard-assessments/${UUID_SEGMENT}#section-apps$`,
  'i',
)

/**
 * The form filler is currently embedded only by a hazard assessment. Keep the
 * post-submit redirect on that exact, non-executable same-origin route instead
 * of accepting an arbitrary path supplied by the browser.
 */
export function parseBuilderReturnTo(value: unknown): string | null {
  return typeof value === 'string' && HAZARD_ASSESSMENT_RETURN.test(value) ? value : null
}
