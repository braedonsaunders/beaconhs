import { JOURNAL_ENTRY_TAG_LIMIT, JOURNAL_TAG_NAME_LIMIT } from './_types'

/** Validate the action boundary and canonicalize user-entered journal tags. */
export function normalizeJournalTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > JOURNAL_ENTRY_TAG_LIMIT) return null
  if (
    value.some(
      (tag) =>
        typeof tag !== 'string' ||
        tag.trim().length === 0 ||
        tag.trim().length > JOURNAL_TAG_NAME_LIMIT,
    )
  ) {
    return null
  }
  return Array.from(new Set(value.map((tag: string) => tag.trim().toLowerCase())))
}
