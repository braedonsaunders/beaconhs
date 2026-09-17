// Subjects that are designed like a module template but are NOT a record with
// its own print route — they are rendered INSIDE a larger document. The
// document-book cover is one sheet of a composed manual.
//
// They are not Flows subjects: there is no record to trigger on and no adapter
// to load. They exist here purely so the template designer can validate them
// and offer their merge fields — without this, creating a book-cover template
// was silently discarded by `subjectExists`, which is a designer that appears
// to do nothing.

import { DOCUMENT_BOOK_COVER_TOKENS } from '@beaconhs/db'

type SubjectField = { key: string; label: string }

export const COMPONENT_SUBJECT_FIELDS: Record<string, SubjectField[]> = {
  'document-books': DOCUMENT_BOOK_COVER_TOKENS.map((token) => ({ ...token })),
}

export const COMPONENT_SUBJECT_LABELS: Record<string, string> = {
  'document-books': 'Document book (cover)',
}
