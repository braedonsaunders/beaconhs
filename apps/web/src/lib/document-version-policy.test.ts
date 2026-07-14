import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import {
  assertUploadedDocumentPdf,
  documentVersionVisibilityWhere,
} from './document-version-policy'

function compile(includeUnpublished: boolean): string {
  return new PgDialect()
    .sqlToQuery(
      documentVersionVisibilityWhere('00000000-0000-4000-8000-000000000000', includeUnpublished),
    )
    .sql.replaceAll('"', '')
    .toLowerCase()
}

describe('document version visibility policy', () => {
  it('keeps ordinary readers on explicitly published versions', () => {
    expect(compile(false)).toContain('document_versions.published_at is not null')
  })

  it('allows managers to preview an unpublished replacement', () => {
    expect(compile(true)).not.toContain('published_at')
  })

  it('accepts only PDF document attachments as uploaded document versions', () => {
    expect(() =>
      assertUploadedDocumentPdf({ kind: 'document', contentType: 'application/pdf' }),
    ).not.toThrow()
    expect(() =>
      assertUploadedDocumentPdf({ kind: 'document', contentType: 'application/msword' }),
    ).toThrow('Select a valid PDF file.')
    expect(() =>
      assertUploadedDocumentPdf({ kind: 'image', contentType: 'application/pdf' }),
    ).toThrow('Select a valid PDF file.')
  })
})
