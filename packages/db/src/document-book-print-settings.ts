import type { DocumentBookPrintSettings } from './schema/documents'

/**
 * House defaults for how a book prints.
 *
 * `print_settings` is NULL on every book that has never been edited, and NULL
 * means "house defaults", not "everything off" — books created before the
 * setting existed gained the full output without being touched.
 *
 * Shared by the worker that composes the PDF and the builder that edits the
 * settings, so the checkbox a user sees ticked is the behaviour they get.
 */
export const DOCUMENT_BOOK_PRINT_DEFAULTS = {
  paperSize: 'letter',
  orientation: 'portrait',
  // Pages are imposed whole, so the document's own margin already keeps text
  // off the sheet edge; this is an extra inset on top of it.
  contentMarginMm: 0,
  coverPage: true,
  tableOfContents: true,
  documentHeaders: true,
  // The control block rides on the document's first page.
  //
  // That used to cost type: the band reserved 132pt and the page beneath was
  // scaled to fit what was left, so a THIRD of the manual rendered at 9.5pt
  // against 11.5pt elsewhere, with double the left margin — exactly what "the
  // text size keeps changing" and "the margins are way too wide" were. The
  // document render now leaves that strip clear itself, so the band lands in
  // blank space and every page imposes at full size. A sheet of its own is
  // still available, and costs one page per document.
  documentHeadersOnOwnPage: false,
  footer: true,
  documentPageBreaks: true,
} as const satisfies Required<DocumentBookPrintSettings>

export function resolveBookPrintSettings(
  settings: DocumentBookPrintSettings | null | undefined,
): Required<DocumentBookPrintSettings> {
  return { ...DOCUMENT_BOOK_PRINT_DEFAULTS, ...(settings ?? {}) }
}

/**
 * The tokens a designed book cover can reference.
 *
 * Kept flat and few on purpose: these are facts about the book itself, and
 * anything richer belongs in the body rather than the cover sheet.
 *
 * Shared so the three places that must agree cannot drift — the worker that
 * supplies the values, the designer palette that offers them, and the subject
 * validation that decides a book-cover template may exist at all. A token in
 * the palette that the worker never supplies renders as a blank on every
 * printed manual.
 */
export const DOCUMENT_BOOK_COVER_TOKENS = [
  { key: 'book_title', label: 'Book title' },
  { key: 'book_description', label: 'Book description' },
  { key: 'tenant_name', label: 'Company name' },
  { key: 'published_at', label: 'Published on' },
  { key: 'document_count', label: 'Document count' },
  { key: 'chapter_count', label: 'Chapter count' },
  { key: 'section_count', label: 'Section count' },
] as const satisfies readonly { key: string; label: string }[]

export type DocumentBookCoverToken = (typeof DOCUMENT_BOOK_COVER_TOKENS)[number]['key']
