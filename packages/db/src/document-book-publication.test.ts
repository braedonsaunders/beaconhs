import { describe, expect, it } from 'vitest'
import {
  MAX_DOCUMENT_BOOK_ITEMS,
  resolveDocumentBookItems,
  type DocumentBookSnapshotAttachment,
  type DocumentBookSnapshotItem,
  type DocumentBookSnapshotVersion,
} from './document-book-publication'

const item: DocumentBookSnapshotItem = {
  itemId: 'item-1',
  documentId: 'document-1',
  documentTitle: 'Fall protection plan',
  documentKey: 'fall-protection',
  documentStatus: 'published',
  documentDeletedAt: null,
  pinnedVersionId: null,
}

const version: DocumentBookSnapshotVersion = {
  id: 'version-2',
  documentId: item.documentId,
  version: 2,
  pdfAttachmentId: 'pdf-2',
  contentAttachmentId: 'source-2',
}

const pdf: DocumentBookSnapshotAttachment = {
  id: 'pdf-2',
  key: 'tenant/documents/version-2.pdf',
  kind: 'document',
  contentType: 'application/pdf',
  sizeBytes: 4096,
}

describe('document book publication policy', () => {
  it('pins the exact validated PDF artifact for every item', () => {
    expect(
      resolveDocumentBookItems({
        mode: 'publish',
        items: [item],
        versions: [version],
        attachments: [pdf],
      }),
    ).toEqual([
      {
        itemId: item.itemId,
        documentId: item.documentId,
        documentTitle: item.documentTitle,
        documentKey: item.documentKey,
        versionId: version.id,
        version: version.version,
        attachmentId: pdf.id,
        attachmentKey: pdf.key,
        sizeBytes: pdf.sizeBytes,
      },
    ])
  })

  it('allows an empty draft preview but rejects an empty publication', () => {
    expect(
      resolveDocumentBookItems({
        mode: 'draft-render',
        items: [],
        versions: [],
        attachments: [],
      }),
    ).toEqual([])
    expect(() =>
      resolveDocumentBookItems({
        mode: 'publish',
        items: [],
        versions: [],
        attachments: [],
      }),
    ).toThrow('Add at least one published document')
  })

  it('rejects unpublished, deleted, and oversized membership sets', () => {
    expect(() =>
      resolveDocumentBookItems({
        mode: 'publish',
        items: [{ ...item, documentStatus: 'draft' }],
        versions: [version],
        attachments: [pdf],
      }),
    ).toThrow('is not a live published document')
    expect(() =>
      resolveDocumentBookItems({
        mode: 'publish',
        items: [{ ...item, documentDeletedAt: new Date() }],
        versions: [version],
        attachments: [pdf],
      }),
    ).toThrow('is not a live published document')
    expect(() =>
      resolveDocumentBookItems({
        mode: 'publish',
        items: Array.from({ length: MAX_DOCUMENT_BOOK_ITEMS + 1 }, (_, index) => ({
          ...item,
          itemId: `item-${index}`,
          documentId: `document-${index}`,
        })),
        versions: [],
        attachments: [],
      }),
    ).toThrow(`at most ${MAX_DOCUMENT_BOOK_ITEMS}`)
  })

  it('fails closed when a published book has a missing or mismatched pin', () => {
    expect(() =>
      resolveDocumentBookItems({
        mode: 'published-render',
        items: [item],
        versions: [version],
        attachments: [pdf],
      }),
    ).toThrow('has no pinned document version')
    expect(() =>
      resolveDocumentBookItems({
        mode: 'published-render',
        items: [{ ...item, pinnedVersionId: 'some-other-version' }],
        versions: [version],
        attachments: [pdf],
      }),
    ).toThrow('does not match its pinned version')
  })

  it('fails closed when a version or valid PDF attachment is missing', () => {
    expect(() =>
      resolveDocumentBookItems({
        mode: 'publish',
        items: [item],
        versions: [],
        attachments: [],
      }),
    ).toThrow('has no published version')
    expect(() =>
      resolveDocumentBookItems({
        mode: 'publish',
        items: [item],
        versions: [version],
        attachments: [{ ...pdf, contentType: 'application/octet-stream' }],
      }),
    ).toThrow('has no valid PDF attachment')
    expect(() =>
      resolveDocumentBookItems({
        mode: 'publish',
        items: [item],
        versions: [version],
        attachments: [{ ...pdf, sizeBytes: 0 }],
      }),
    ).toThrow('has no valid PDF attachment')
  })

  it('accepts an uploaded PDF as a file-only published version', () => {
    const fileVersion = { ...version, pdfAttachmentId: null, contentAttachmentId: 'source-2' }
    const sourcePdf = { ...pdf, id: 'source-2', key: 'tenant/documents/uploaded.pdf' }
    const [resolved] = resolveDocumentBookItems({
      mode: 'publish',
      items: [item],
      versions: [fileVersion],
      attachments: [sourcePdf],
    })
    expect(resolved?.attachmentId).toBe(sourcePdf.id)
    expect(resolved?.versionId).toBe(fileVersion.id)
  })
})
