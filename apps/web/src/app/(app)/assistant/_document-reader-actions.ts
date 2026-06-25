'use server'

// Loads a controlled document's FULL rendered HTML for the in-chat reader panel.
// Permission is enforced identically to the assistant's read_document tool: the
// user must hold documents.read (or manage), and non-managers see published docs
// only (documentReadFilter). Unlike the tool — which truncates to plain text for
// the model's context — this returns the complete sanitized HTML for a human to
// read, so the reader can show long documents in full.

import { and, desc, eq, isNull, type SQL } from 'drizzle-orm'
import { documentDrafts, documentVersions, documents } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { sanitizeDocumentHtml } from '@beaconhs/forms-core'
import { requireRequestContext } from '@/lib/auth'
import { documentReadFilter } from '@/lib/assistant/doc-access'

export type ReaderDocument = {
  id: string
  key: string
  title: string
  status: string
  category: string | null
  updatedAt: string | null
  /** Sanitized HTML body. Empty string when the document has no content yet. */
  html: string
}

export type ReaderResult = { ok: true; doc: ReaderDocument } | { ok: false; error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function getReaderDocument(id: string): Promise<ReaderResult> {
  if (!UUID.test(id)) return { ok: false, error: 'not_found' }
  const ctx = await requireRequestContext()
  if (!can(ctx, 'documents.read') && !can(ctx, 'documents.manage')) {
    return { ok: false, error: 'forbidden' }
  }
  return ctx.db(async (tx) => {
    const conds: SQL[] = [eq(documents.id, id), isNull(documents.deletedAt)]
    const filter = documentReadFilter(ctx)
    if (filter) conds.push(filter)
    const [doc] = await tx
      .select({
        id: documents.id,
        key: documents.key,
        title: documents.title,
        status: documents.status,
        category: documents.category,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(and(...conds))
      .limit(1)
    if (!doc) return { ok: false, error: 'not_found' }

    // Prefer the latest published version; fall back to the working draft.
    const [pub] = await tx
      .select({ html: documentVersions.contentMarkdown })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, id))
      .orderBy(desc(documentVersions.version))
      .limit(1)
    let html = pub?.html ?? null
    if (!html) {
      const [draft] = await tx
        .select({ html: documentDrafts.contentHtml })
        .from(documentDrafts)
        .where(eq(documentDrafts.documentId, id))
        .limit(1)
      html = draft?.html ?? null
    }

    return {
      ok: true,
      doc: {
        id: doc.id,
        key: doc.key,
        title: doc.title,
        status: doc.status,
        category: doc.category,
        updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : null,
        // Defense-in-depth: content is sanitized on write, sanitized again here.
        html: html ? sanitizeDocumentHtml(html) : '',
      },
    }
  })
}
