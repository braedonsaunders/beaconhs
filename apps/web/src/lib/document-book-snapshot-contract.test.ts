import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

describe('document book publication snapshot contract', () => {
  it('publishes and unpublishes only through the atomic snapshot lifecycle', () => {
    const page = source('../app/(app)/documents/books/[id]/page.tsx')
    expect(page).toContain('publishDocumentBook(tx, ctx, bookId)')
    expect(page).toContain('unpublishDocumentBook(tx, ctx, bookId)')
    expect(page).not.toContain(".set({ status: 'published', publishedAt:")
  })

  it.each([
    ['single add and settings', '../app/(app)/documents/books/[id]/page.tsx'],
    ['reorder and remove', '../app/(app)/documents/books/[id]/actions.ts'],
    ['bulk add', '../app/(app)/documents/_actions.ts'],
  ])('%s locks the draft book before mutation', (_label, relativePath) => {
    expect(source(relativePath)).toContain('lockDraftDocumentBook(')
  })

  it('offers only live published documents and draft books to add flows', () => {
    const picker = source('../app/api/picker-options/route.ts')
    const actions = source('../app/(app)/documents/_actions.ts')
    expect(picker).toContain("? eq(documents.status, 'published')")
    expect(actions).toContain('livePublishedDocumentIds(')
    expect(actions).toContain("eq(documentBooks.status, 'draft')")
  })

  it('renders published books from exact pins and validates every artifact', () => {
    const worker = source('../../../worker/src/workers/pdf.ts')
    expect(worker).toContain("mode: row.b.status === 'published' ? 'published-render'")
    expect(worker).toContain('inArray(documentVersions.id, pinnedIds)')
    expect(worker).toContain('metadata.contentLength !== e.sizeBytes')
    expect(worker).not.toContain('(no published PDF)')
  })

  it('protects documents referenced by published books from destructive lifecycle changes', () => {
    const deletion = source('./document-deletion.ts')
    const detail = source('../app/(app)/documents/[id]/page.tsx')
    expect(deletion).toContain('publishedBookReferencesForDocuments(')
    expect(detail).toContain('assertDocumentNotInPublishedBook(')
  })
})
