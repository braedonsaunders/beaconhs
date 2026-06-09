'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@beaconhs/ui'
import {
  BulkDocumentsBar,
  HeaderSelectAll,
  SelectionCheckbox,
  type DocumentBookOption,
} from './_bulk-bar'

export type DocumentsTableRow = {
  id: string
  title: string
  category: string | null
  type: { name: string; color: string | null } | null
  status: 'draft' | 'published' | 'archived' | 'under_review'
  nextReviewOn: string | null
}

export function DocumentsRecordsTable({
  rows,
  books,
}: {
  rows: DocumentsTableRow[]
  books: DocumentBookOption[]
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const allSelected = useMemo(
    () => rows.length > 0 && rows.every((r) => selected.has(r.id)),
    [rows, selected],
  )

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelected((prev) => {
      if (rows.length > 0 && rows.every((r) => prev.has(r.id))) return new Set()
      return new Set(rows.map((r) => r.id))
    })
  }
  function clear() {
    setSelected(new Set())
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="w-8 px-3 py-2">
                <HeaderSelectAll allSelected={allSelected} onToggleAll={toggleAll} />
              </th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Next review</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const isSelected = selected.has(r.id)
              return (
                <tr
                  key={r.id}
                  className={isSelected ? 'bg-teal-50/40' : 'hover:bg-slate-50/50'}
                >
                  <td className="w-8 px-3 py-2">
                    <SelectionCheckbox
                      id={r.id}
                      selected={isSelected}
                      onToggle={toggleOne}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/documents/${r.id}` as any}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.category ?? '—'}</td>
                  <td className="px-3 py-2">
                    {r.type ? (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
                        style={
                          r.type.color
                            ? { backgroundColor: `${r.type.color}1a`, color: r.type.color }
                            : { backgroundColor: '#f1f5f9', color: '#475569' }
                        }
                      >
                        {r.type.color ? (
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.type.color }} />
                        ) : null}
                        {r.type.name}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={r.status === 'published' ? 'success' : 'secondary'}>
                      {r.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.nextReviewOn ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <BulkDocumentsBar
        selectedIds={Array.from(selected)}
        onClear={clear}
        books={books}
      />
    </>
  )
}
