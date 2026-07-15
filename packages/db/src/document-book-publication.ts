export const MAX_DOCUMENT_BOOK_ITEMS = 200

type DocumentBookSnapshotMode = 'publish' | 'published-render' | 'draft-render'

export type DocumentBookSnapshotItem = {
  itemId: string
  documentId: string
  documentTitle: string
  documentKey: string
  documentStatus: string
  documentDeletedAt: Date | null
  pinnedVersionId: string | null
}

export type DocumentBookSnapshotVersion = {
  id: string
  documentId: string
  version: number
  pdfAttachmentId: string | null
  contentAttachmentId: string | null
}

export type DocumentBookSnapshotAttachment = {
  id: string
  kind: string
  contentType: string
  sizeBytes: number
  key: string
}

type ResolvedDocumentBookItem = {
  itemId: string
  documentId: string
  documentTitle: string
  documentKey: string
  versionId: string
  version: number
  attachmentId: string
  attachmentKey: string
  sizeBytes: number
}

function itemLabel(item: DocumentBookSnapshotItem): string {
  return item.documentTitle.trim() || item.documentKey
}

/**
 * Resolve and validate the immutable PDF source for every document-book item.
 *
 * Callers query either the latest published version for each document
 * (`publish` / `draft-render`) or the exact pinned versions
 * (`published-render`). This pure boundary prevents the web publisher and PDF
 * worker from drifting into different publication rules.
 */
export function resolveDocumentBookItems(input: {
  mode: DocumentBookSnapshotMode
  items: readonly DocumentBookSnapshotItem[]
  versions: readonly DocumentBookSnapshotVersion[]
  attachments: readonly DocumentBookSnapshotAttachment[]
}): ResolvedDocumentBookItem[] {
  const { mode, items, versions, attachments } = input
  if (items.length > MAX_DOCUMENT_BOOK_ITEMS) {
    throw new Error(`Document books may contain at most ${MAX_DOCUMENT_BOOK_ITEMS} documents.`)
  }
  if (mode !== 'draft-render' && items.length === 0) {
    throw new Error('Add at least one published document before publishing this book.')
  }

  const unavailableDocument = items.find(
    (item) => item.documentDeletedAt !== null || item.documentStatus !== 'published',
  )
  if (unavailableDocument) {
    throw new Error(
      `"${itemLabel(unavailableDocument)}" is not a live published document. Remove it or publish it before publishing the book.`,
    )
  }

  const versionByDocument = new Map(versions.map((version) => [version.documentId, version]))
  const attachmentById = new Map(attachments.map((attachment) => [attachment.id, attachment]))

  return items.map((item) => {
    if (mode === 'published-render' && !item.pinnedVersionId) {
      throw new Error(`Published book item ${item.documentKey} has no pinned document version.`)
    }
    const version = versionByDocument.get(item.documentId)
    if (!version) {
      throw new Error(`"${itemLabel(item)}" has no published version.`)
    }
    if (mode === 'published-render' && version.id !== item.pinnedVersionId) {
      throw new Error(`Published book item ${item.documentKey} does not match its pinned version.`)
    }

    const attachmentId = version.pdfAttachmentId ?? version.contentAttachmentId
    const attachment = attachmentId ? attachmentById.get(attachmentId) : undefined
    if (
      !attachment ||
      attachment.kind !== 'document' ||
      attachment.contentType !== 'application/pdf' ||
      attachment.sizeBytes <= 0
    ) {
      throw new Error(
        `Published version ${version.version} for document ${item.documentKey} has no valid PDF attachment.`,
      )
    }

    return {
      itemId: item.itemId,
      documentId: item.documentId,
      documentTitle: item.documentTitle,
      documentKey: item.documentKey,
      versionId: version.id,
      version: version.version,
      attachmentId: attachment.id,
      attachmentKey: attachment.key,
      sizeBytes: attachment.sizeBytes,
    }
  })
}
