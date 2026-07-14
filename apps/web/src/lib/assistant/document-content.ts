// Full-text extraction for the assistant's document tools. Returns the COMPLETE
// readable text of a controlled document — in-app HTML docs are flattened to
// text, uploaded PDFs (documentVersions.contentAttachmentId) are run through
// `unpdf` (serverless pdf.js). This is what lets the agent read a hundreds-of-
// page PDF: read_document pages through this text and search_document greps it,
// the same way Claude Code navigates a large file (windowed read + search).
//
// Extraction is cached in-memory keyed by document+version so a long PDF is only
// parsed once per process. Permission is enforced exactly like the read tools
// (documents.read/manage + published-only for non-managers via documentReadFilter).

import { and, desc, eq, isNull, type SQL } from 'drizzle-orm'
import { attachments, documentVersions, documents } from '@beaconhs/db/schema'
import { can, type RequestContext } from '@beaconhs/tenant'
import { getObject } from '@beaconhs/storage'
import { documentVersionVisibilityWhere } from '@/lib/document-version-policy'
import { documentReadFilter } from './doc-access'

type DocumentTextSource = 'html' | 'pdf' | 'empty'

type DocumentText = {
  id: string
  key: string
  title: string
  status: string
  /** Full plain text of the document (may be very long). */
  text: string
  source: DocumentTextSource
  /** Page count for PDFs, else null. */
  pages: number | null
  /** True when a PDF yielded almost no text — likely a scanned/image-only PDF
   *  that needs visual reading rather than text extraction. */
  scanned: boolean
}

/** Returned when the document isn't found or the user may not read it. */
type DocumentTextResult =
  { ok: true; doc: DocumentText } | { ok: false; error: 'not_found' | 'forbidden' }

// ---- extraction cache ------------------------------------------------------

type CacheEntry = {
  source: DocumentTextSource
  text: string
  pages: number | null
  scanned: boolean
}
const CACHE = new Map<string, CacheEntry>()
const CACHE_MAX = 64

function cacheGet(key: string): CacheEntry | undefined {
  return CACHE.get(key)
}
function cacheSet(key: string, entry: CacheEntry): void {
  // Tiny LRU: evict the oldest insertion when full.
  if (CACHE.size >= CACHE_MAX) {
    const oldest = CACHE.keys().next().value
    if (oldest !== undefined) CACHE.delete(oldest)
  }
  CACHE.set(key, entry)
}

/** Extract text from a PDF buffer with unpdf. Pages are separated by a marker so
 *  read_document/search_document can report which page a hit came from. */
async function extractPdfText(
  buffer: Buffer,
): Promise<{ text: string; pages: number; scanned: boolean }> {
  // Lazy import keeps unpdf (and its bundled pdf.js) out of any non-PDF path.
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const { totalPages, text } = await extractText(pdf, { mergePages: false })
  const pageTexts = Array.isArray(text) ? text : [text]
  const joined = pageTexts
    .map((t, i) => `\n[Page ${i + 1}]\n${(t ?? '').replace(/[ \t]+/g, ' ').trim()}`)
    .join('\n')
    .trim()
  // Heuristic: a real text PDF has plenty of characters per page. A scanned PDF
  // (image-only, no text layer) yields almost nothing.
  const stripped = joined.replace(/\[Page \d+\]/g, '').replace(/\s+/g, '')
  const scanned = totalPages > 0 && stripped.length / totalPages < 24
  return { text: joined, pages: totalPages, scanned }
}

// ---- main entry ------------------------------------------------------------

/**
 * Load a document's full readable text, permission-gated and cached. The text
 * may be very long (a 200-page PDF) — callers window or search it rather than
 * sending the whole thing to the model.
 */
export async function getDocumentText(
  ctx: RequestContext,
  id: string,
): Promise<DocumentTextResult> {
  if (!can(ctx, 'documents.read') && !can(ctx, 'documents.manage')) {
    return { ok: false, error: 'forbidden' }
  }
  const includeUnpublished = ctx.isSuperAdmin || can(ctx, 'documents.manage')
  return ctx.db(async (tx): Promise<DocumentTextResult> => {
    const conds: SQL[] = [eq(documents.id, id), isNull(documents.deletedAt)]
    const filter = documentReadFilter(ctx)
    if (filter) conds.push(filter)
    const [doc] = await tx
      .select({
        id: documents.id,
        key: documents.key,
        title: documents.title,
        status: documents.status,
      })
      .from(documents)
      .where(and(...conds))
      .limit(1)
    if (!doc) return { ok: false, error: 'not_found' }

    // The latest visible version drives the cache key + content source.
    // Managers may inspect an uploaded replacement before publishing; readers
    // remain on the last explicitly published version.
    const [version] = await tx
      .select({
        id: documentVersions.id,
        version: documentVersions.version,
        text: documentVersions.textContent,
        attachmentId: documentVersions.contentAttachmentId,
      })
      .from(documentVersions)
      .where(documentVersionVisibilityWhere(id, includeUnpublished))
      .orderBy(desc(documentVersions.version))
      .limit(1)

    const cacheKey = `${id}:${version?.id ?? 'draft'}`
    const cached = cacheGet(cacheKey)
    if (cached) {
      return { ok: true, doc: { ...doc, ...cached } }
    }

    let entry: CacheEntry

    // Uploaded PDF source → extract text with unpdf.
    if (version?.attachmentId) {
      const [att] = await tx
        .select({ r2Key: attachments.r2Key, contentType: attachments.contentType })
        .from(attachments)
        .where(eq(attachments.id, version.attachmentId))
        .limit(1)
      if (att?.contentType === 'application/pdf') {
        try {
          const buffer = await getObject({ key: att.r2Key })
          const { text, pages, scanned } = await extractPdfText(buffer)
          entry = { source: 'pdf', text, pages, scanned }
        } catch (e) {
          console.warn(`[assistant] PDF extraction failed for ${id}`, e)
          entry = { source: 'empty', text: '', pages: null, scanned: false }
        }
      } else {
        // Non-PDF attachment (e.g. an image) — no text layer to read.
        entry = { source: 'empty', text: '', pages: null, scanned: false }
      }
    } else {
      // Authored document → the text the worker extracted from the published
      // DOCX snapshot (unpublished drafts live in the Word master and aren't
      // readable here).
      const text = (version?.text ?? '').trim()
      entry = { source: text ? 'html' : 'empty', text, pages: null, scanned: false }
    }

    cacheSet(cacheKey, entry)
    return { ok: true, doc: { ...doc, ...entry } }
  })
}

// ---- raw PDF bytes (for vision rasterization) ------------------------------

type DocumentPdfBytesResult =
  | { ok: true; bytes: Buffer; title: string }
  | { ok: false; error: 'not_found' | 'forbidden' | 'not_pdf' }

/**
 * Load the raw PDF bytes of a document's latest version, permission-gated exactly
 * like getDocumentText. The vision tool uses this to rasterize pages for an
 * image-only (scanned) PDF. Returns `not_pdf` when the latest version isn't an
 * uploaded PDF (in-app HTML docs have no file to render).
 */
export async function getDocumentPdfBytes(
  ctx: RequestContext,
  id: string,
): Promise<DocumentPdfBytesResult> {
  if (!can(ctx, 'documents.read') && !can(ctx, 'documents.manage')) {
    return { ok: false, error: 'forbidden' }
  }
  const includeUnpublished = ctx.isSuperAdmin || can(ctx, 'documents.manage')
  return ctx.db(async (tx): Promise<DocumentPdfBytesResult> => {
    const conds: SQL[] = [eq(documents.id, id), isNull(documents.deletedAt)]
    const filter = documentReadFilter(ctx)
    if (filter) conds.push(filter)
    const [doc] = await tx
      .select({ title: documents.title })
      .from(documents)
      .where(and(...conds))
      .limit(1)
    if (!doc) return { ok: false, error: 'not_found' }

    const [version] = await tx
      .select({ attachmentId: documentVersions.contentAttachmentId })
      .from(documentVersions)
      .where(documentVersionVisibilityWhere(id, includeUnpublished))
      .orderBy(desc(documentVersions.version))
      .limit(1)
    if (!version?.attachmentId) return { ok: false, error: 'not_pdf' }

    const [att] = await tx
      .select({ r2Key: attachments.r2Key, contentType: attachments.contentType })
      .from(attachments)
      .where(eq(attachments.id, version.attachmentId))
      .limit(1)
    if (att?.contentType !== 'application/pdf') return { ok: false, error: 'not_pdf' }

    try {
      const bytes = await getObject({ key: att.r2Key })
      return { ok: true, bytes, title: doc.title }
    } catch (e) {
      console.warn(`[assistant] PDF bytes load failed for ${id}`, e)
      return { ok: false, error: 'not_found' }
    }
  })
}
