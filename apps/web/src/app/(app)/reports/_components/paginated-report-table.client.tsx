'use client'

// Paginated, click-to-sort result table for the report viewer and the studio
// preview. Rows are positional arrays (ReportGroup.rows). Page-size control +
// prev/next + "X–Y of N" footer; dark-mode aware. Mirrors the Insights
// data-table footer so every result grid feels the same.

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { Select, cn } from '@beaconhs/ui'

type Cell = string | number | null | undefined

const PAGE_SIZES = [10, 25, 50, 100]

export function PaginatedReportTable({
  columns,
  rows,
  initialPageSize = 25,
  dense = false,
}: {
  columns: string[]
  rows: Cell[][]
  initialPageSize?: number
  dense?: boolean
}) {
  const [sort, setSort] = useState<{ idx: number; dir: 'asc' | 'desc' } | null>(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(initialPageSize)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const i = sort.idx
    const numeric = rows.every((r) => r[i] === null || r[i] === '' || typeof r[i] === 'number')
    return [...rows].sort((a, b) => {
      const av = a[i]
      const bv = b[i]
      if (av === null || av === undefined || av === '') return 1
      if (bv === null || bv === undefined || bv === '') return -1
      const cmp = numeric
        ? Number(av) - Number(bv)
        : String(av).localeCompare(String(bv), undefined, { numeric: true })
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [rows, sort])

  // Reset to the first page whenever the underlying data changes.
  useEffect(() => setPage(0), [rows])

  const total = sorted.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const start = safePage * pageSize
  const pageRows = sorted.slice(start, start + pageSize)

  function toggleSort(idx: number) {
    setSort((s) =>
      s?.idx === idx ? { idx, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { idx, dir: 'asc' },
    )
    setPage(0)
  }

  const cellPad = dense ? 'px-2.5 py-1' : 'px-3 py-1.5'

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800">
              {columns.map((c, i) => {
                const active = sort?.idx === i
                return (
                  <th
                    key={`${c}-${i}`}
                    onClick={() => toggleSort(i)}
                    className={cn(
                      'sticky top-0 z-10 cursor-pointer border-b border-slate-200 bg-slate-50 text-left font-semibold whitespace-nowrap text-slate-600 select-none hover:text-slate-900 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-slate-100',
                      cellPad,
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c}
                      {active ? (
                        sort.dir === 'asc' ? (
                          <ChevronUp size={12} />
                        ) : (
                          <ChevronDown size={12} />
                        )
                      ) : (
                        <ChevronsUpDown size={12} className="opacity-40" />
                      )}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, ri) => (
              <tr key={start + ri} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                {columns.map((_, ci) => {
                  const v = row[ci]
                  const empty = v === null || typeof v === 'undefined' || v === ''
                  return (
                    <td
                      key={ci}
                      className={cn(
                        'max-w-[28rem] truncate border-b border-slate-100 dark:border-slate-800',
                        typeof v === 'number'
                          ? 'text-right text-slate-800 tabular-nums dark:text-slate-200'
                          : 'text-slate-600 dark:text-slate-300',
                        cellPad,
                      )}
                    >
                      {empty ? (
                        <span className="text-slate-300 dark:text-slate-600">—</span>
                      ) : (
                        String(v)
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
            {total === 0 ? (
              <tr>
                <td
                  colSpan={Math.max(1, columns.length)}
                  className="px-3 py-6 text-center text-xs text-slate-400 dark:text-slate-500"
                >
                  No rows.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 px-3 py-1.5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <span className="tabular-nums">
          {total === 0
            ? 'No rows'
            : `${start + 1}–${Math.min(start + pageSize, total)} of ${total}`}
        </span>
        <div className="flex items-center gap-2">
          <Select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value))
              setPage(0)
            }}
            className="h-7 text-xs"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s} / page
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="grid h-7 w-7 place-items-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
              aria-label="Previous page"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="tabular-nums">
              {safePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={safePage >= pageCount - 1}
              className="grid h-7 w-7 place-items-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
              aria-label="Next page"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
