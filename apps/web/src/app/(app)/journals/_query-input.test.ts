import { describe, expect, it } from 'vitest'
import { normalizeJournalFilters, normalizeJournalGroupBy } from './_query-input'

describe('journal server-action query input', () => {
  it('accepts bounded known filters and rejects untrusted fields', () => {
    expect(
      normalizeJournalFilters({
        q: `  ${'x'.repeat(300)}  `,
        site: 'not-a-uuid',
        tag: ' Concrete ',
        status: 'submitted',
        definition: 'unexpected',
        from: '2026-02-29',
        to: '2026-12-31',
        mine: true,
      }),
    ).toEqual({
      q: 'x'.repeat(200),
      tag: 'concrete',
      status: 'submitted',
      to: '2026-12-31',
    })
  })

  it('normalizes grouping to a known value', () => {
    expect(normalizeJournalGroupBy('topic')).toBe('topic')
    expect(normalizeJournalGroupBy('person')).toBe('date')
  })
})
