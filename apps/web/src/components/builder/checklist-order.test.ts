import { describe, expect, it } from 'vitest'
import {
  moveItemById,
  replaceItemsById,
  replaceScopedItems,
  resequenceItems,
  sequenceCriteria,
} from './checklist-order'

describe('checklist ordering', () => {
  it('resequences only the active scope and preserves another PPE checklist', () => {
    const annual = { id: 'annual', kind: 'annual', sequence: 4 }
    const originalPreUse = [
      { id: 'second', kind: 'pre_use', sequence: 8 },
      { id: 'first', kind: 'pre_use', sequence: 3 },
    ]
    const preUse = resequenceItems(originalPreUse)

    expect(
      replaceScopedItems([annual, ...originalPreUse], preUse, (item) => item.kind === 'pre_use'),
    ).toEqual([
      annual,
      { id: 'second', kind: 'pre_use', sequence: 0 },
      { id: 'first', kind: 'pre_use', sequence: 1 },
    ])
  })

  it('moves an item immutably and refuses missing or out-of-range moves', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

    expect(moveItemById(items, 'b', -1)?.map((item) => item.id)).toEqual(['b', 'a', 'c'])
    expect(items.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(moveItemById(items, 'a', -1)).toBeNull()
    expect(moveItemById(items, 'c', 1)).toBeNull()
    expect(moveItemById(items, 'missing', 1)).toBeNull()
  })

  it('moves a reordered criterion slice to its new group without changing unrelated rows', () => {
    const untouched = { id: 'outside', groupId: 'other', sequence: 7, question: 'Outside' }
    const reordered = sequenceCriteria(
      [
        { id: 'b', groupId: 'old', sequence: 9, question: 'B' },
        { id: 'a', groupId: 'old', sequence: 4, question: 'A' },
      ],
      'new',
    )

    const original = [
      untouched,
      { id: 'a', groupId: 'old', sequence: 4, question: 'A' },
      { id: 'b', groupId: 'old', sequence: 9, question: 'B' },
    ]

    expect(replaceItemsById(original, reordered)).toEqual([
      untouched,
      { id: 'b', groupId: 'new', sequence: 0, question: 'B' },
      { id: 'a', groupId: 'new', sequence: 1, question: 'A' },
    ])
  })
})
