import { isUuid } from './list-params'

const REMOTE_SEARCH_TEXT_LIMIT = 100

export type RemoteSearchInput = {
  query: string
  selected: string | null
}

type SelectedKind = 'uuid' | 'text'

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Search request is invalid.')
  }
  return value as Record<string, unknown>
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const allowed = new Set(keys)
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error('Search request is invalid.')
  }
}

function boundedText(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} is invalid.`)
  if (value.length > REMOTE_SEARCH_TEXT_LIMIT) {
    throw new Error(`${field} must be ${REMOTE_SEARCH_TEXT_LIMIT} characters or less.`)
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${field} is invalid.`)
  return value.trim()
}

/**
 * Strict parser for action-backed RemoteSearchSelect loaders. Keeping this
 * boundary shared prevents each public or purpose-specific picker from
 * silently accepting augmented payloads, control characters, or unbounded
 * search text.
 */
export function parseRemoteSearchInput(
  value: unknown,
  selectedKind: SelectedKind,
): RemoteSearchInput {
  const record = asRecord(value)
  assertExactKeys(record, ['query', 'selected'])
  const query = boundedText(record.query, 'Search text')
  if (record.selected === null || record.selected === '') return { query, selected: null }

  if (selectedKind === 'uuid') {
    if (typeof record.selected !== 'string' || !isUuid(record.selected)) {
      throw new Error('Selected option is invalid.')
    }
    return { query, selected: record.selected.toLowerCase() }
  }

  const selected = boundedText(record.selected, 'Selected option')
  return { query, selected: selected || null }
}

/** Escape user text before wrapping it in a parameterised ILIKE pattern. */
export function remoteSearchTerm(query: string): string | null {
  if (!query) return null
  return `%${query.replace(/[%_\\]/g, (match) => `\\${match}`)}%`
}
