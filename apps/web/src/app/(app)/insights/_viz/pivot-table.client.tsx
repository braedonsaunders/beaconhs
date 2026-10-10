'use client'

import { useMemo, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@beaconhs/ui'
import {
  RAG_DISCRETE,
  pivotAxisLabel,
  pivotDisplayValue,
  resolveCellStyle,
  type CfRule,
  type PivotResult,
  type VizSettings,
} from '@beaconhs/analytics'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'

function fmt(value: unknown): string {
  if (value === null || value === undefined || value === '' || value === 'missing') return ''
  return typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(2) : String(value)
}

export function PivotTable({
  result,
  settings = {},
  tableKey = 'pivot',
}: {
  result: PivotResult
  settings?: VizSettings
  tableKey?: string
}) {
  const translate = useGeneratedValueTranslations()
  const search = useSearchParams()
  const pathname = usePathname()
  const [columnWidth, setColumnWidth] = useState(132)
  const queryKey = `${tableKey}_q`
  const pageKey = `${tableKey}_page`
  const query = (search.get(queryKey) ?? '').trim().toLocaleLowerCase()
  const value = result.valueMeasures[0]
  const rules = useMemo<CfRule[]>(() => {
    const configured = settings.conditionalFormats as CfRule[] | undefined
    return configured?.length
      ? configured
      : value?.dataType === 'string'
        ? [{ type: 'discrete', column: value.key, map: RAG_DISCRETE }]
        : []
  }, [settings.conditionalFormats, value])
  const rows = result.rowKeys
    .map((axis, index) => ({
      index,
      label: pivotAxisLabel(axis, result.rowDimensions, settings.rowLabelField),
    }))
    .filter((row) => !query || row.label.toLocaleLowerCase().includes(query))
  const pageCount = Math.max(1, Math.ceil(rows.length / 25))
  const requested = Number(search.get(pageKey) ?? 1)
  const page = Math.max(1, Math.min(pageCount, Number.isSafeInteger(requested) ? requested : 1))
  const pageRows = rows.slice((page - 1) * 25, page * 25)
  const columns = result.columnKeys.map((axis) =>
    pivotAxisLabel(axis, result.columnDimensions, settings.columnLabelField),
  )
  const rowLabel =
    result.rowDimensions.find((d) => d.key === settings.rowLabelField)?.label ??
    result.rowDimensions.map((d) => d.label).join(' · ')

  if (!value) {
    return (
      <div className="grid h-full place-items-center rounded-lg border border-dashed border-slate-200 p-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
        <GeneratedValue value="No data for these filters." />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 p-2 dark:border-slate-800">
        <SearchInput
          paramKey={queryKey}
          pageParamKey={pageKey}
          placeholder={translate('Search people…')}
          className="min-w-40 flex-1"
        />
        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <GeneratedValue value="Column width" />
          <input
            type="range"
            min={96}
            max={240}
            step={8}
            value={columnWidth}
            onChange={(event) => setColumnWidth(Number(event.target.value))}
            aria-label={translate('Column width')}
            className="w-24 accent-teal-600"
          />
        </label>
        {typeof settings.displayValueField === 'string' ? (
          <div className="flex flex-wrap gap-3 text-xs">
            {(['valid', 'expiring', 'expired'] as const).map((status) => (
              <span
                key={status}
                className={cn(
                  'rounded px-2 py-1',
                  resolveCellStyle(status, value.key, rules).className,
                )}
              >
                <GeneratedValue
                  value={
                    status === 'valid' ? 'Valid' : status === 'expiring' ? 'Expiring' : 'Expired'
                  }
                />
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {result.truncated ? (
        <p
          role="status"
          className="bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
        >
          <GeneratedValue value="This matrix reached its data limit. Use Filters to narrow the results." />
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <table
          className="table-fixed border-separate border-spacing-0 text-xs"
          style={{ width: 220 + columns.length * columnWidth }}
        >
          <colgroup>
            <col style={{ width: 220 }} />
            {columns.map((_column, index) => (
              <col key={index} style={{ width: columnWidth }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky top-0 left-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200"
              >
                <GeneratedValue value={rowLabel} />
              </th>
              {columns.map((column, index) => (
                <th
                  key={index}
                  scope="col"
                  title={translate(column)}
                  className="sticky top-0 z-10 border-b border-l border-slate-200 bg-slate-50 px-2 py-2 text-left font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200"
                >
                  <span className="block truncate">
                    <GeneratedValue value={column} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.index}>
                <th
                  scope="row"
                  title={translate(row.label)}
                  className="sticky left-0 z-10 truncate border-b border-slate-100 bg-white px-3 py-2 text-left font-normal text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                >
                  <GeneratedValue value={row.label} />
                </th>
                {columns.map((column, index) => {
                  const cell = result.cells[row.index]?.[index] ?? null
                  const raw = cell?.[value.key] ?? null
                  const display = fmt(pivotDisplayValue(cell, value.key, settings))
                  const status = translate(raw === null ? '' : String(raw).replaceAll('_', ' '))
                  const style = resolveCellStyle(raw, value.key, rules)
                  return (
                    <td
                      key={index}
                      title={[translate(row.label), translate(column), status, translate(display)]
                        .filter(Boolean)
                        .join(' · ')}
                      className={cn(
                        'truncate border-b border-l border-slate-100 px-2 py-2 text-center tabular-nums dark:border-slate-800',
                        style.className,
                        !style.className && 'text-slate-600 dark:text-slate-300',
                      )}
                      style={
                        style.backgroundColor
                          ? { backgroundColor: style.backgroundColor }
                          : undefined
                      }
                    >
                      <GeneratedValue value={display} />
                    </td>
                  )
                })}
              </tr>
            ))}
            {pageRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-3 py-8 text-slate-500 dark:text-slate-400"
                >
                  <GeneratedValue
                    value={query ? 'No matching people.' : 'No data for these filters.'}
                  />
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Pagination
        basePath={pathname}
        currentParams={Object.fromEntries(search.entries())}
        total={rows.length}
        page={page}
        perPage={25}
        pageParamKey={pageKey}
      />
    </div>
  )
}
