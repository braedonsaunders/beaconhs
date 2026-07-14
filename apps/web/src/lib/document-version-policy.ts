import { and, eq, isNotNull, type SQL } from 'drizzle-orm'
import { documentVersions } from '@beaconhs/db/schema'

/**
 * One visibility rule for every "latest document version" reader.
 *
 * Managers may preview an unpublished uploaded-PDF replacement. Everyone else
 * must remain on the latest published version until that replacement is
 * explicitly published.
 */
export function documentVersionVisibilityWhere(
  documentId: string,
  includeUnpublished: boolean,
): SQL {
  const document = eq(documentVersions.documentId, documentId)
  return includeUnpublished ? document : and(document, isNotNull(documentVersions.publishedAt))!
}

type UploadedDocumentPdf = {
  kind: string
  contentType: string
}

/** Uploaded-file document versions are PDF-only; other document uploads have
 * dedicated import flows and must never become an unreadable PDF version. */
export function assertUploadedDocumentPdf(attachment: UploadedDocumentPdf): void {
  if (attachment.kind !== 'document' || attachment.contentType !== 'application/pdf') {
    throw new Error('Select a valid PDF file.')
  }
}
