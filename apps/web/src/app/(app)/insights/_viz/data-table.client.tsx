'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

// Flat table renderer: click-to-sort headers, number/date formatting, per-column
// conditional formatting, and PAGINATION (page-size control + prev/next). Used by
// the builder live preview, the card viewer, and dashboard cells. Dark-mode aware.

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { Select, cn } from '@beaconhs/ui'
import {
  resolveCellStyle,
  type CfRule,
  type FlatResult,
  type ResultColumn,
  type VizSettings,
} from '@beaconhs/analytics'

const PAGE_SIZES = [10, 25, 50, 100]

function fmtCell(v: unknown, col: ResultColumn): string {
  if (v === null || typeof v === 'undefined' || v === '') return '—'
  if (col.dataType === 'number' && typeof v === 'number') {
    return Number.isInteger(v)
      ? v.toLocaleString()
      : v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  if (col.dataType === 'timestamp') return String(v).slice(0, 16).replace('T', ' ')
  return String(v)
}

export function DataTable({
  result,
  settings = {},
}: {
  result: FlatResult
  settings?: VizSettings
}) {
  const tGenerated = useGeneratedTranslations()
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null)
  const [pagination, setPagination] = useState({ rows: result.rows, page: 0 })
  const [pageSize, setPageSize] = useState(25)
  const rules = (settings.conditionalFormats as CfRule[] | undefined) ?? []

  const sorted = useMemo(() => {
    if (!sort) return result.rows
    const col = result.columns.find((c) => c.key === sort.key)
    if (!col) return result.rows
    const numeric = col.dataType === 'number'
    return [...result.rows].sort((a, b) => {
      const av = a[sort.key]
      const bv = b[sort.key]
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = numeric ? Number(av) - Number(bv) : String(av).localeCompare(String(bv))
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [result.rows, result.columns, sort])

  const total = sorted.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = pagination.rows === result.rows ? pagination.page : 0
  const safePage = Math.min(page, pageCount - 1)
  const start = safePage * pageSize
  const pageRows = sorted.slice(start, start + pageSize)

  function toggleSort(key: string) {
    setSort((s) =>
      s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    )
    setPagination({ rows: result.rows, page: 0 })
  }

  if (result.columns.length === 0) {
    return (
      <div className="grid h-full place-items-center text-xs text-slate-400 dark:text-slate-500">
        <GeneratedText id="m_09750de58b1490" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800">
              <GeneratedValue
                value={result.columns.map((c) => {
                  const active = sort?.key === c.key
                  return (
                    <th
                      key={c.key}
                      onClick={() => toggleSort(c.key)}
                      className={cn(
                        'sticky top-0 z-10 cursor-pointer border-b border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-600 select-none hover:text-slate-900 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-slate-100',
                        c.role === 'measure' ? 'text-right' : 'text-left',
                      )}
                    >
                      <span
                        className={cn(
                          'inline-flex items-center gap-1',
                          c.role === 'measure' && 'flex-row-reverse',
                        )}
                      >
                        <GeneratedValue value={c.label} />
                        <GeneratedValue
                          value={
                            active ? (
                              sort.dir === 'asc' ? (
                                <ChevronUp size={12} />
                              ) : (
                                <ChevronDown size={12} />
                              )
                            ) : (
                              <ChevronsUpDown size={12} className="opacity-40" />
                            )
                          }
                        />
                      </span>
                    </th>
                  )
                })}
              />
            </tr>
          </thead>
          <tbody>
            <GeneratedValue
              value={pageRows.map((row, ri) => (
                <tr key={start + ri} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <GeneratedValue
                    value={result.columns.map((c) => {
                      const style = resolveCellStyle(row[c.key], c.key, rules)
                      return (
                        <td
                          key={c.key}
                          className={cn(
                            'border-b border-slate-100 px-3 py-1.5 dark:border-slate-800',
                            c.role === 'measure'
                              ? 'text-right font-medium text-slate-800 tabular-nums dark:text-slate-200'
                              : 'text-slate-600 dark:text-slate-300',
                            style.className,
                          )}
                          style={
                            style.backgroundColor
                              ? { backgroundColor: style.backgroundColor }
                              : undefined
                          }
                        >
                          <GeneratedValue value={fmtCell(row[c.key], c)} />
                        </td>
                      )
                    })}
                  />
                </tr>
              ))}
            />
            <GeneratedValue
              value={
                total === 0 ? (
                  <tr>
                    <td
                      colSpan={result.columns.length}
                      className="px-3 py-6 text-center text-xs text-slate-400 dark:text-slate-500"
                    >
                      <GeneratedText id="m_126f736e7419f7" />
                    </td>
                  </tr>
                ) : null
              }
            />
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 px-3 py-1.5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <span className="tabular-nums">
          <GeneratedValue
            value={
              total === 0 ? (
                <GeneratedText id="m_02f2fc9625bf45" />
              ) : (
                <GeneratedText
                  id="m_17abd8a26b9020"
                  values={{
                    value0: start + 1,
                    value1: Math.min(start + pageSize, total),
                    value2: total,
                  }}
                />
              )
            }
          />
          <GeneratedValue value={result.truncated ? <GeneratedText id="m_08f1207533fcbc" /> : ''} />
        </span>
        <div className="flex items-center gap-2">
          <Select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value))
              setPagination({ rows: result.rows, page: 0 })
            }}
            className="h-7 text-xs"
          >
            <GeneratedValue
              value={PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  <GeneratedValue value={s} /> <GeneratedText id="m_0f439c799f9bf5" />
                </option>
              ))}
            />
          </Select>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPagination({ rows: result.rows, page: Math.max(0, safePage - 1) })}
              disabled={safePage === 0}
              className="grid h-7 w-7 place-items-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
              aria-label={tGenerated('m_1a91739487f373')}
            >
              <ChevronLeft size={14} />
            </button>
            <span className="tabular-nums">
              <GeneratedValue value={safePage + 1} /> / <GeneratedValue value={pageCount} />
            </span>
            <button
              type="button"
              onClick={() =>
                setPagination({
                  rows: result.rows,
                  page: Math.min(pageCount - 1, safePage + 1),
                })
              }
              disabled={safePage >= pageCount - 1}
              className="grid h-7 w-7 place-items-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
              aria-label={tGenerated('m_08e164e340384f')}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
