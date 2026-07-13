import cronParser from 'cron-parser'

// cron-parser v4 is CommonJS. Its declarations expose parseExpression as a
// named member, but native Node ESM only provides the CommonJS namespace as
// the default export when esbuild leaves npm dependencies external.
const { parseExpression } = cronParser

export type CronFields = { expression: string }

/** Validate a standard five-field Vixie cron expression. */
export function parseCron(expr: string): CronFields {
  const expression = expr.trim()
  const parts = expression.split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`cron must have 5 fields, got ${parts.length}: ${expr}`)
  }
  parseExpression(expression, { tz: 'UTC' })
  return { expression }
}

export function nextCronAfter(c: CronFields, from: Date, timezone = 'UTC'): Date | null {
  try {
    return parseExpression(c.expression, { currentDate: from, tz: timezone }).next().toDate()
  } catch {
    return null
  }
}

/** Most recent occurrence in `(after, now]`, without replaying missed slots. */
export function lastCronOccurrenceBetween(
  c: CronFields,
  after: Date,
  now: Date,
  timezone = 'UTC',
): Date | null {
  try {
    // `prev()` is exclusive. One millisecond includes an occurrence exactly on
    // the current minute boundary.
    const latest = parseExpression(c.expression, {
      currentDate: new Date(now.getTime() + 1),
      tz: timezone,
    })
      .prev()
      .toDate()
    return latest.getTime() > after.getTime() ? latest : null
  } catch {
    return null
  }
}

export function cronOccursAt(expression: string, at: Date, timezone = 'UTC'): boolean {
  const minute = Math.floor(at.getTime() / 60_000) * 60_000
  const occurrence = lastCronOccurrenceBetween(
    parseCron(expression),
    new Date(minute - 1),
    at,
    timezone,
  )
  return occurrence?.getTime() === minute
}
