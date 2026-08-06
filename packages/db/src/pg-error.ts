// Postgres error introspection that survives the driver/ORM wrapper chain.
//
// drizzle-orm wraps every driver failure in a `DrizzleQueryError` whose
// `cause` is the postgres.js `PostgresError` carrying the real SQLSTATE. A
// bare `error.code === '23505'` check therefore never matches and the raw
// "Failed query: insert into …" dump leaks to the user instead of the
// friendly message. Always go through these helpers.

/** SQLSTATE codes worth branching on. */
export const PG_UNIQUE_VIOLATION = '23505'
export const PG_FOREIGN_KEY_VIOLATION = '23503'
export const PG_NOT_NULL_VIOLATION = '23502'
export const PG_CHECK_VIOLATION = '23514'

export type PgErrorInfo = {
  code: string
  /** Constraint name, when the driver reports one. */
  constraint: string | null
  detail: string | null
  table: string | null
  column: string | null
}

function field(source: Record<string, unknown>, ...names: string[]): string | null {
  for (const name of names) {
    const value = source[name]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

/**
 * Walk the `cause` chain and return the first Postgres error found. Handles a
 * bare PostgresError, a DrizzleQueryError wrapping one, and any future nesting.
 */
export function pgError(error: unknown): PgErrorInfo | null {
  let current = error
  // Bounded so a self-referential cause can never spin.
  for (let depth = 0; depth < 10 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as Record<string, unknown>
    const code = candidate.code
    // SQLSTATE is always five alphanumeric characters — this keeps us from
    // mistaking Node's own string codes (ENOENT, MODULE_NOT_FOUND, …) for one.
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      return {
        code,
        constraint: field(candidate, 'constraint_name', 'constraint'),
        detail: field(candidate, 'detail'),
        table: field(candidate, 'table_name', 'table'),
        column: field(candidate, 'column_name', 'column'),
      }
    }
    current = candidate.cause
  }
  return null
}

/** SQLSTATE for an error, or null when it isn't a Postgres failure. */
export function pgErrorCode(error: unknown): string | null {
  return pgError(error)?.code ?? null
}

/**
 * True when the error is a unique-constraint violation. Pass `constraint` to
 * match one specific index — important where a table has several unique
 * indexes and only one of them maps to the message you want to show.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const info = pgError(error)
  if (!info || info.code !== PG_UNIQUE_VIOLATION) return false
  return constraint === undefined || info.constraint === constraint
}

export function isForeignKeyViolation(error: unknown, constraint?: string): boolean {
  const info = pgError(error)
  if (!info || info.code !== PG_FOREIGN_KEY_VIOLATION) return false
  return constraint === undefined || info.constraint === constraint
}

/**
 * Message safe to show a user: never the raw "Failed query: …" SQL dump that
 * drizzle puts on the wrapper's `message`.
 */
export function safeDbErrorMessage(error: unknown, fallback: string): string {
  if (pgError(error)) return fallback
  if (error instanceof Error && !error.message.startsWith('Failed query:')) return error.message
  return fallback
}
