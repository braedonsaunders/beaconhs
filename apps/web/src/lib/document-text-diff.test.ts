import { describe, expect, it } from 'vitest'
import { contextualizeDocumentDiff, diffDocumentText } from './document-text-diff'

describe('document text diff', () => {
  it('reports each inserted and removed line with stable old and new line numbers', () => {
    const diff = diffDocumentText('Title\nOld detail\nKeep', 'Title\nNew detail\nAdded\nKeep')

    expect(diff.additions).toBe(2)
    expect(diff.removals).toBe(1)
    expect(diff.lines).toEqual([
      { kind: 'equal', text: 'Title', beforeLine: 1, afterLine: 1 },
      { kind: 'removed', text: 'Old detail', beforeLine: 2, afterLine: null },
      { kind: 'added', text: 'New detail', beforeLine: null, afterLine: 2 },
      { kind: 'added', text: 'Added', beforeLine: null, afterLine: 3 },
      { kind: 'equal', text: 'Keep', beforeLine: 3, afterLine: 4 },
    ])
  })

  it('collapses unchanged text while keeping context around every change', () => {
    const before = Array.from({ length: 12 }, (_, index) => `Line ${index + 1}`).join('\n')
    const after = before.replace('Line 7', 'Changed 7')
    const rows = contextualizeDocumentDiff(diffDocumentText(before, after).lines, 1)

    expect(rows.map((row) => row.kind)).toEqual([
      'skipped',
      'equal',
      'removed',
      'added',
      'equal',
      'skipped',
    ])
  })

  it('returns no display rows when versions have identical extracted text', () => {
    const diff = diffDocumentText('Same\nText', 'Same\nText')
    expect(diff).toMatchObject({ additions: 0, removals: 0 })
    expect(contextualizeDocumentDiff(diff.lines)).toEqual([])
  })
})
