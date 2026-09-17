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
  // Cropping removes the source document's own margins, so this IS the book's
  // page margin — not an addition to the source's. Zero would print text on the
  // sheet edge, inside the non-printable border of most office printers.
  contentMarginMm: 10,
  coverPage: true,
  tableOfContents: true,
  documentHeaders: true,
  // The control block rides on the document's first page. Giving it a sheet of
  // its own doubled the page count of a book whose members are mostly one page.
  documentHeadersOnOwnPage: false,
  footer: true,
  documentPageBreaks: true,
  normalizeContent: true,
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
