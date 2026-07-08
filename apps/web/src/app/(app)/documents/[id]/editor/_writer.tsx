'use client'

// Client shell for the full-screen Writer: binds the WOPI session fetcher to
// the shared Collabora embed (live master, or a read-only version snapshot).

import { CollaboraEmbed } from '@/components/collabora-embed'
import { getDocumentWriterSession } from '../_master-actions'

export function DocumentWriter({
  documentId,
  versionId,
  attachmentId,
}: {
  documentId: string
  versionId: string | null
  /** The backing attachment (master or version snapshot) — remount key. */
  attachmentId: string | null
}) {
  return (
    <CollaboraEmbed
      key={attachmentId ?? 'none'}
      frameName={versionId ? `${documentId}-${versionId}` : documentId}
      fetchSession={() => getDocumentWriterSession(documentId, versionId ?? undefined)}
      className="min-h-0 flex-1"
    />
  )
}
