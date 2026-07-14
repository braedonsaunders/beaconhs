import { randomUUID } from 'node:crypto'
import { isUuid } from './list-params'

export const MAX_BULK_ACTION_ITEMS = 500

/** Correlation id shared by the audit rows produced by one bulk mutation. */
export function newBulkActionBatchId(): string {
  return `bat_${randomUUID()}`
}

type BulkActionIdsResult = { ok: true; ids: string[] } | { ok: false; error: string }

/**
 * Server actions receive untrusted serialized values despite their TypeScript
 * signatures. Normalize one bounded UUID selection before it reaches a UUID
 * column comparison, and reject rather than silently truncating an oversized
 * operation.
 */
export function parseBulkActionIds(
  value: unknown,
  labels: { singular: string; plural: string },
): BulkActionIdsResult {
  if (!Array.isArray(value)) {
    return { ok: false, error: `The ${labels.singular} selection is invalid.` }
  }
  if (value.length === 0) return { ok: false, error: `No ${labels.plural} selected.` }
  if (value.length > MAX_BULK_ACTION_ITEMS) {
    return {
      ok: false,
      error: `Select no more than ${MAX_BULK_ACTION_ITEMS} ${labels.plural} at once.`,
    }
  }

  const ids: string[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (typeof raw !== 'string' || !isUuid(raw)) {
      return { ok: false, error: `The ${labels.singular} selection is invalid.` }
    }
    const id = raw.toLowerCase()
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return { ok: true, ids }
}

export function isBulkActionId(value: unknown): value is string {
  return typeof value === 'string' && isUuid(value)
}
