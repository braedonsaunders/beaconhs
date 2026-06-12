'use client'

// Read-only document-books library for users without `documents.manage`. A card
// grid; clicking a book opens its combined multi-document PDF (rendered on
// demand) in a modal. No edit / reorder affordances.

import { useState } from 'react'
import { Library } from 'lucide-react'
import { ReadOnlyPdfModal, type PdfResolveResult } from '../_read-only-pdf-modal'

export type ReadOnlyBook = {
  id: string
  title: string
  description: string | null
  category: string | null
  documentCount: number
}

// Books always render on demand (no uploaded artifact) → hit the route directly.
const resolveBookPdf = async (id: string): Promise<PdfResolveResult> => ({
  ok: true,
  url: `/documents/books/${id}/pdf?render=${Date.now()}`,
})

export function ReadOnlyBooksGrid({ books }: { books: ReadOnlyBook[] }) {
  const [active, setActive] = useState<ReadOnlyBook | null>(null)
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {books.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setActive(b)}
            className="group flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-700"
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                <Library size={18} />
              </span>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {b.documentCount} {b.documentCount === 1 ? 'doc' : 'docs'}
              </span>
            </div>
            <h3 className="line-clamp-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              {b.title}
            </h3>
            {b.category ? (
              <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                {b.category}
              </p>
            ) : null}
            {b.description ? (
              <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {b.description}
              </p>
            ) : null}
            <span className="mt-auto inline-flex items-center gap-1.5 pt-4 text-xs font-semibold text-teal-600 group-hover:gap-2 dark:text-teal-400">
              <Library size={13} /> View PDF
            </span>
          </button>
        ))}
      </div>
      {active ? (
        <ReadOnlyPdfModal
          id={active.id}
          title={active.title}
          resolve={resolveBookPdf}
          onClose={() => setActive(null)}
        />
      ) : null}
    </>
  )
}
