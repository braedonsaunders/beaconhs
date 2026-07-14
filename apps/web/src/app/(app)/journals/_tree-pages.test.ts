import { describe, expect, it } from 'vitest'
import { isTreeCursor, mergeTreePages } from './_tree-pages'

describe('journal tree cursor validation', () => {
  it('accepts only canonical database cursors', () => {
    expect(
      isTreeCursor({
        entryDate: '2026-07-13',
        createdAt: '2026-07-13T12:34:56.000Z',
        asOf: '2026-07-13T12:35:00.000Z',
        id: '10000000-0000-4000-8000-000000000001',
      }),
    ).toBe(true)
    expect(
      isTreeCursor({
        entryDate: '2026-02-30',
        createdAt: 'yesterday',
        asOf: 'tomorrow',
        id: 'not-a-uuid',
      }),
    ).toBe(false)
  })
})

describe('journal tree page merging', () => {
  it('merges date branches and preserves distinct leaves', () => {
    const merged = mergeTreePages(
      [
        {
          key: '2026',
          label: '2026',
          count: 1,
          children: [
            {
              key: '2026-07',
              label: 'July',
              count: 1,
              children: [{ key: 'a', label: 'new', count: 1, entryId: 'a' }],
            },
          ],
        },
      ],
      [
        {
          key: '2026',
          label: '2026',
          count: 1,
          children: [
            {
              key: '2026-07',
              label: 'July',
              count: 1,
              children: [{ key: 'b', label: 'older', count: 1, entryId: 'b' }],
            },
          ],
        },
      ],
      'date',
    )

    expect(merged[0]?.count).toBe(2)
    expect(merged[0]?.children?.[0]?.count).toBe(2)
    expect(merged[0]?.children?.[0]?.children?.map((node) => node.entryId)).toEqual(['a', 'b'])
  })

  it('does not duplicate a leaf when paging across concurrent changes', () => {
    const leaf = { key: 'site:entry', label: 'Entry', count: 1, entryId: 'entry' }
    const merged = mergeTreePages(
      [{ key: 'site', label: 'Site', count: 1, children: [leaf] }],
      [{ key: 'site', label: 'Site', count: 1, children: [leaf] }],
      'site',
    )

    expect(merged[0]?.count).toBe(1)
    expect(merged[0]?.children).toHaveLength(1)
  })

  it('re-sorts topic groups after their loaded counts change', () => {
    const merged = mergeTreePages(
      [
        {
          key: 't-a',
          label: 'Alpha',
          count: 2,
          children: [
            { key: 'a1', label: 'A1', count: 1, entryId: 'a1' },
            { key: 'a2', label: 'A2', count: 1, entryId: 'a2' },
          ],
        },
        {
          key: 't-b',
          label: 'Beta',
          count: 1,
          children: [{ key: 'b1', label: 'B1', count: 1, entryId: 'b1' }],
        },
      ],
      [
        {
          key: 't-b',
          label: 'Beta',
          count: 3,
          children: [
            { key: 'b2', label: 'B2', count: 1, entryId: 'b2' },
            { key: 'b3', label: 'B3', count: 1, entryId: 'b3' },
            { key: 'b4', label: 'B4', count: 1, entryId: 'b4' },
          ],
        },
      ],
      'topic',
    )

    expect(merged.map((node) => node.label)).toEqual(['Beta', 'Alpha'])
  })
})
