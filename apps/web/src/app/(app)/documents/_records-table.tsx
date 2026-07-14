'use client'

import Link from 'next/link'
import { Badge } from '@beaconhs/ui'
import { RowSelectionButton, SelectVisibleRowsButton } from '@/components/row-selection-buttons'
import { SortTh } from '@/components/sortable-th'
import { ListCard, MobileCardList } from '@/components/list-card'
import { useRowSelection } from '@/lib/row-selection'
import { BulkDocumentsBar, type DocumentBookOption } from './_bulk-bar'

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
  basePath,
  currentParams,
  sort,
  dir,
}: {
  rows: DocumentsTableRow[]
  books: DocumentBookOption[]
  basePath: string
  currentParams: Record<string, string | string[] | undefined>
  sort: string
  dir: 'asc' | 'desc'
}) {
  const { selected, selectedIds, allSelected, toggleOne, toggleAll, clear } = useRowSelection(rows)

  const sortProps = { basePath, currentParams, sort, dir }

  return (
    <>
      {/* Phones: tappable cards (bulk-select via the leading checkbox). */}
      <MobileCardList>
        {rows.map((r) => (
          <ListCard
            key={r.id}
            href={`/documents/${r.id}`}
            leading={
              <RowSelectionButton id={r.id} selected={selected.has(r.id)} onToggle={toggleOne} />
            }
            status={
              <Badge variant={r.status === 'published' ? 'success' : 'secondary'}>{r.status}</Badge>
            }
            title={r.title}
            meta={
              [r.category, r.nextReviewOn ? `Review ${r.nextReviewOn}` : null]
                .filter(Boolean)
                .join(' · ') || undefined
            }
            footer={
              r.type ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
                  style={
                    r.type.color
                      ? { backgroundColor: `${r.type.color}1a`, color: r.type.color }
                      : { backgroundColor: '#f1f5f9', color: '#475569' }
                  }
                >
                  {r.type.color ? (
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: r.type.color }}
                    />
                  ) : null}
                  {r.type.name}
                </span>
              ) : null
            }
          />
        ))}
      </MobileCardList>

      {/* Tablet/desktop: full sortable table. */}
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white sm:block dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
              <th className="w-8 px-3 py-2">
                <SelectVisibleRowsButton allSelected={allSelected} onToggleAll={toggleAll} />
              </th>
              <SortTh column="title" {...sortProps}>
                Title
              </SortTh>
              <SortTh column="category" {...sortProps}>
                Category
              </SortTh>
              <th className="px-3 py-2">Type</th>
              <SortTh column="status" {...sortProps}>
                Status
              </SortTh>
              <SortTh column="next_review_on" {...sortProps}>
                Next review
              </SortTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => {
              const isSelected = selected.has(r.id)
              return (
                <tr
                  key={r.id}
                  className={
                    isSelected
                      ? 'bg-teal-50/40 dark:bg-teal-500/10'
                      : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/60'
                  }
                >
                  <td className="w-8 px-3 py-2">
                    <RowSelectionButton id={r.id} selected={isSelected} onToggle={toggleOne} />
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/documents/${r.id}` as any}
                      className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                    >
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {r.category ?? '—'}
                  </td>
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
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: r.type.color }}
                          />
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
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {r.nextReviewOn ?? '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <BulkDocumentsBar selectedIds={selectedIds} onClear={clear} books={books} />
    </>
  )
}
