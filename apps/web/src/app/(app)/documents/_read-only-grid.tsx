'use client'

// Read-only documents library for users without `documents.manage` (everyone
// except Administration / Health & Safety). A responsive card grid; clicking a
// card opens the document's PDF (rendered on demand) in a modal. No edit affordances.

import { useState } from 'react'
import { FileText } from 'lucide-react'
import { getDocumentPdfUrl } from './[id]/_actions'
import { ReadOnlyPdfModal } from './_read-only-pdf-modal'

export type ReadOnlyDoc = {
  id: string
  title: string
  description: string | null
  category: string | null
  type: { name: string; color: string | null } | null
}

export function ReadOnlyDocumentsGrid({ docs }: { docs: ReadOnlyDoc[] }) {
  const [active, setActive] = useState<ReadOnlyDoc | null>(null)
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {docs.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setActive(d)}
            className="group flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-700"
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-950/60 dark:text-teal-400">
                <FileText size={18} />
              </span>
              {d.type ? (
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: hexAlpha(d.type.color, 0.13),
                    color: d.type.color ?? '#475569',
                  }}
                >
                  {d.type.name}
                </span>
              ) : null}
            </div>
            <h3 className="line-clamp-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              {d.title}
            </h3>
            {d.category ? (
              <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                {d.category}
              </p>
            ) : null}
            {d.description ? (
              <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {d.description}
              </p>
            ) : null}
            <span className="mt-auto inline-flex items-center gap-1.5 pt-4 text-xs font-semibold text-teal-600 group-hover:gap-2 dark:text-teal-400">
              <FileText size={13} /> View PDF
            </span>
          </button>
        ))}
      </div>
      {active ? (
        <ReadOnlyPdfModal
          id={active.id}
          title={active.title}
          resolve={getDocumentPdfUrl}
          onClose={() => setActive(null)}
        />
      ) : null}
    </>
  )
}

function hexAlpha(hex: string | null, alpha: number): string {
  if (!hex || !/^#?[0-9a-fA-F]{6}$/.test(hex)) return `rgba(100,116,139,${alpha})`
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
