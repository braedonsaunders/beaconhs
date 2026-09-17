// A book is stored as one flat, ordered list of entries. Its structure is
// expressed by ORDER alone — a chapter owns everything until the next chapter,
// a section everything until the next heading — rather than by parent pointers.
//
// That is deliberate. The PDF composer prints the book by walking the list once
// in order; a tree would have to be flattened on every render anyway, and two
// representations of "what comes after what" is exactly the kind of thing that
// drifts. The builder derives a tree for display, edits the tree, and flattens
// straight back.

export type BookEntry = {
  itemId: string
  kind: 'document' | 'section' | 'chapter'
  /** Null for a chapter or section heading. */
  documentId: string | null
  title: string
  status: 'draft' | 'published' | 'archived' | 'under_review' | null
  pinnedVersion: number | null
}

/** A run of documents under one section heading. */
export type BookSectionNode = {
  section: BookEntry
  documents: BookEntry[]
}

/**
 * A run of content under one chapter heading. `chapter` is null for the bucket
 * before the first chapter — a book need not use chapters at all, and one that
 * starts with a few loose documents must still render them.
 */
export type BookChapterNode = {
  chapter: BookEntry | null
  /** Documents directly under the chapter, before its first section. */
  documents: BookEntry[]
  sections: BookSectionNode[]
}

export function buildBookTree(entries: readonly BookEntry[]): BookChapterNode[] {
  const chapters: BookChapterNode[] = [{ chapter: null, documents: [], sections: [] }]

  for (const entry of entries) {
    const current = chapters[chapters.length - 1]!
    if (entry.kind === 'chapter') {
      chapters.push({ chapter: entry, documents: [], sections: [] })
    } else if (entry.kind === 'section') {
      current.sections.push({ section: entry, documents: [] })
    } else {
      const openSection = current.sections[current.sections.length - 1]
      if (openSection) openSection.documents.push(entry)
      else current.documents.push(entry)
    }
  }

  // Drop the leading bucket unless the book actually opens with content outside
  // a chapter; otherwise every chaptered book grows an empty phantom card.
  const [first] = chapters
  if (first && !first.chapter && first.documents.length === 0 && first.sections.length === 0) {
    chapters.shift()
  }
  return chapters
}

export function flattenBookTree(chapters: readonly BookChapterNode[]): BookEntry[] {
  const entries: BookEntry[] = []
  for (const chapter of chapters) {
    if (chapter.chapter) entries.push(chapter.chapter)
    entries.push(...chapter.documents)
    for (const section of chapter.sections) {
      entries.push(section.section)
      entries.push(...section.documents)
    }
  }
  return entries
}

/**
 * Move one entry by a single step through the FLAT list.
 *
 * Deliberately flat rather than within its bucket: on a book, "down" past the
 * last document of a section should carry the document into the next section.
 * That is the only way to move an entry between chapters without deleting and
 * re-adding it, since a drag cannot cross two reorder groups.
 *
 * Moving a heading carries everything it owns, so a chapter travels as a
 * chapter rather than being dismantled one row at a time.
 */
export function moveBookEntry(
  entries: readonly BookEntry[],
  itemId: string,
  direction: -1 | 1,
): BookEntry[] | null {
  const index = entries.findIndex((entry) => entry.itemId === itemId)
  if (index < 0) return null
  const entry = entries[index]!
  const block = entries.slice(index, index + blockLength(entries, index))
  const rest = [...entries.slice(0, index), ...entries.slice(index + block.length)]

  const target =
    direction === -1
      ? previousSiblingStart(rest, index, entry.kind)
      : nextSiblingEnd(rest, index, entry.kind)
  if (target === null) return null
  return [...rest.slice(0, target), ...block, ...rest.slice(target)]
}

/** How many entries the one at `index` carries with it. */
function blockLength(entries: readonly BookEntry[], index: number): number {
  const kind = entries[index]!.kind
  if (kind === 'document') return 1
  let length = 1
  while (index + length < entries.length) {
    const next = entries[index + length]!.kind
    if (next === 'chapter') break
    if (kind === 'section' && next === 'section') break
    length++
  }
  return length
}

/**
 * Where a block must land to sit one step earlier. A document steps over one
 * entry; a heading steps over the whole preceding block of its own level, so it
 * swaps with its sibling instead of burrowing into it.
 */
function previousSiblingStart(
  rest: readonly BookEntry[],
  index: number,
  kind: BookEntry['kind'],
): number | null {
  if (index === 0) return null
  if (kind === 'document') return index - 1
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const candidate = rest[cursor]!.kind
    if (candidate === 'chapter') return cursor
    if (kind === 'section' && candidate === 'section') return cursor
  }
  return 0
}

/** Where a block must land to sit one step later. */
function nextSiblingEnd(
  rest: readonly BookEntry[],
  index: number,
  kind: BookEntry['kind'],
): number | null {
  if (index >= rest.length) return null
  if (kind === 'document') return index + 1
  // A section at the end of its chapter steps INTO the next chapter, landing
  // first inside it — not over the whole chapter, which would skip its contents.
  if (kind === 'section' && rest[index]!.kind === 'chapter') return index + 1
  const start = index + blockLength(rest, index)
  return start > rest.length ? null : start
}

/**
 * Printed position of each document, keyed by entry id.
 *
 * Headings are unnumbered: a heading is not an item of the contents, it names
 * the run that follows it.
 */
export function documentNumbering(entries: readonly BookEntry[]): Map<string, number> {
  const numbering = new Map<string, number>()
  let printed = 0
  for (const entry of entries) {
    if (entry.kind !== 'document') continue
    printed++
    numbering.set(entry.itemId, printed)
  }
  return numbering
}
