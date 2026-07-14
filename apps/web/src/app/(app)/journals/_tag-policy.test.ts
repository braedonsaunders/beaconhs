import { describe, expect, it } from 'vitest'
import { JOURNAL_ENTRY_TAG_LIMIT, JOURNAL_TAG_NAME_LIMIT } from './_types'
import { normalizeJournalTags } from './_tag-policy'

describe('journal tag mutation policy', () => {
  it('normalizes case, whitespace, and duplicates without truncating', () => {
    expect(normalizeJournalTags([' Concrete ', 'concrete', 'Traffic Control'])).toEqual([
      'concrete',
      'traffic control',
    ])
  })

  it('rejects too many tags instead of accepting a partial list', () => {
    expect(
      normalizeJournalTags(
        Array.from({ length: JOURNAL_ENTRY_TAG_LIMIT + 1 }, (_, index) => `tag-${index}`),
      ),
    ).toBeNull()
  })

  it('rejects empty, overlong, and non-string tag values', () => {
    expect(normalizeJournalTags([''])).toBeNull()
    expect(normalizeJournalTags(['x'.repeat(JOURNAL_TAG_NAME_LIMIT + 1)])).toBeNull()
    expect(normalizeJournalTags([42])).toBeNull()
  })
})
