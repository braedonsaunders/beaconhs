import { describe, expect, it } from 'vitest'
import {
  buildBookTree,
  documentNumbering,
  flattenBookTree,
  moveBookEntry,
  type BookEntry,
} from './book-tree'

function entry(itemId: string, kind: BookEntry['kind']): BookEntry {
  return {
    itemId,
    kind,
    documentId: kind === 'document' ? `doc-${itemId}` : null,
    title: itemId,
    status: kind === 'document' ? 'published' : null,
    pinnedVersion: null,
  }
}

/** "c1 d1 s1 d2" → the flat entry list it reads as. */
function parse(spec: string): BookEntry[] {
  return spec
    .split(' ')
    .map((token) =>
      entry(
        token,
        token.startsWith('c') ? 'chapter' : token.startsWith('s') ? 'section' : 'document',
      ),
    )
}

const ids = (entries: readonly BookEntry[]) => entries.map((item) => item.itemId).join(' ')

describe('buildBookTree', () => {
  it('nests documents under the section under the chapter that precede them', () => {
    const tree = buildBookTree(parse('c1 s1 d1 d2 s2 d3 c2 d4'))
    expect(tree).toHaveLength(2)
    expect(tree[0]!.chapter!.itemId).toBe('c1')
    expect(tree[0]!.sections.map((s) => s.section.itemId)).toEqual(['s1', 's2'])
    expect(ids(tree[0]!.sections[0]!.documents)).toBe('d1 d2')
    expect(ids(tree[0]!.sections[1]!.documents)).toBe('d3')
    expect(tree[1]!.chapter!.itemId).toBe('c2')
    expect(ids(tree[1]!.documents)).toBe('d4')
  })

  it('keeps a bucket for content before the first chapter', () => {
    // A book need not use chapters at all; one that opens with loose documents
    // must still render them somewhere.
    const tree = buildBookTree(parse('d1 s1 d2 c1 d3'))
    expect(tree[0]!.chapter).toBeNull()
    expect(ids(tree[0]!.documents)).toBe('d1')
    expect(ids(tree[0]!.sections[0]!.documents)).toBe('d2')
    expect(tree[1]!.chapter!.itemId).toBe('c1')
  })

  it('omits the leading bucket when the book opens with a chapter', () => {
    // Otherwise every chaptered book grows an empty phantom card above it.
    const tree = buildBookTree(parse('c1 d1'))
    expect(tree).toHaveLength(1)
    expect(tree[0]!.chapter!.itemId).toBe('c1')
  })

  it('round-trips through flatten unchanged', () => {
    const entries = parse('d0 c1 d1 s1 d2 d3 s2 c2 s3 d4')
    expect(ids(flattenBookTree(buildBookTree(entries)))).toBe(ids(entries))
  })

  it('handles an empty book', () => {
    expect(buildBookTree([])).toEqual([])
    expect(flattenBookTree([])).toEqual([])
  })
})

describe('moveBookEntry', () => {
  it('steps a document one place through the flat list', () => {
    expect(ids(moveBookEntry(parse('d1 d2 d3'), 'd2', 1)!)).toBe('d1 d3 d2')
    expect(ids(moveBookEntry(parse('d1 d2 d3'), 'd2', -1)!)).toBe('d2 d1 d3')
  })

  it('carries a document across a section boundary', () => {
    // Moving between buckets is the whole reason the arrows work on the flat
    // list — a drag cannot cross two reorder groups.
    expect(ids(moveBookEntry(parse('s1 d1 s2 d2'), 'd1', 1)!)).toBe('s1 s2 d1 d2')
  })

  it('moves a chapter with everything it owns', () => {
    expect(ids(moveBookEntry(parse('c1 d1 d2 c2 d3'), 'c2', -1)!)).toBe('c2 d3 c1 d1 d2')
    expect(ids(moveBookEntry(parse('c1 d1 c2 d2'), 'c1', 1)!)).toBe('c2 d2 c1 d1')
  })

  it('moves a section with its documents but not past its chapter', () => {
    expect(ids(moveBookEntry(parse('c1 s1 d1 s2 d2'), 's1', 1)!)).toBe('c1 s2 d2 s1 d1')
  })

  it('carries a section into the next chapter rather than over it', () => {
    // Stepping over the whole chapter would skip its contents, which reads as
    // the section vanishing.
    expect(ids(moveBookEntry(parse('c1 s1 d1 c2 d2'), 's1', 1)!)).toBe('c1 c2 s1 d1 d2')
  })

  it('refuses to move the first entry up or the last down', () => {
    expect(moveBookEntry(parse('d1 d2'), 'd1', -1)).toBeNull()
    expect(moveBookEntry(parse('d1 d2'), 'd2', 1)).toBeNull()
  })

  it('returns null for an entry that is not in the book', () => {
    expect(moveBookEntry(parse('d1'), 'nope', 1)).toBeNull()
  })

  it('never loses or duplicates an entry', () => {
    const entries = parse('d0 c1 d1 s1 d2 c2 s2 d3')
    for (const item of entries) {
      for (const direction of [-1, 1] as const) {
        const next = moveBookEntry(entries, item.itemId, direction)
        if (!next) continue
        expect(next).toHaveLength(entries.length)
        expect([...next].map((e) => e.itemId).sort()).toEqual(entries.map((e) => e.itemId).sort())
      }
    }
  })
})

describe('documentNumbering', () => {
  it('numbers documents continuously and skips headings', () => {
    // A heading is not an item of the contents — it names the run that follows
    // it — so numbering it would offset every entry after it.
    const numbering = documentNumbering(parse('c1 d1 s1 d2 c2 d3'))
    expect(numbering.get('d1')).toBe(1)
    expect(numbering.get('d2')).toBe(2)
    expect(numbering.get('d3')).toBe(3)
    expect(numbering.has('c1')).toBe(false)
    expect(numbering.has('s1')).toBe(false)
  })
})
