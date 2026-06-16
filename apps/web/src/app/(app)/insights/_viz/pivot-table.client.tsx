'use client'

// Pivot / matrix renderer. Consumes the engine's PivotResult (already reshaped —
// this does layout + conditional formatting only). Sticky row header + column
// header, RAG/heatmap cell coloring, dark-mode aware (mandate). The styling
// language is lifted from the hand-built /training/matrix page.

import { useMemo } from 'react'
import { cn } from '@beaconhs/ui'
import {
  RAG_DISCRETE,
  resolveCellStyle,
  type CfRule,
  type PivotResult,
  type VizSettings,
} from '@beaconhs/analytics'

function fmt(v: unknown): string {
  if (v === null || typeof v === 'undefined' || v === '') return ''
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2)
  return String(v)
}

export function PivotTable({
  result,
  settings = {},
}: {
  result: PivotResult
  settings?: VizSettings
}) {
  const value = result.valueMeasures[0]
  const rules = useMemo<CfRule[]>(() => {
    const configured = settings.conditionalFormats as CfRule[] | undefined
    if (configured?.length) return configured
    // Sensible default: a categorical cell value (string measure) gets RAG colors.
    if (value && value.dataType === 'string') {
      return [{ type: 'discrete', column: value.key, map: RAG_DISCRETE }]
    }
    return []
  }, [settings.conditionalFormats, value])

  if (!value) {
    return <Empty message="Add a value to the pivot." />
  }
  if (result.rowKeys.length === 0 || result.columnKeys.length === 0) {
    return <Empty message="No data for this pivot." />
  }

  const rowSpanLabel = result.rowDimensions.map((d) => d.label).join(' · ')

  return (
    <div className="h-full overflow-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <table className="min-w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr className="bg-slate-50 dark:bg-slate-800">
            <th className="sticky top-0 left-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300">
              {rowSpanLabel}
            </th>
            {result.columnKeys.map((ck, ci) => (
              <th
                key={ci}
                title={ck.labels.join(' · ')}
                className="sticky top-0 z-10 max-w-[140px] truncate border-b border-l border-slate-200 bg-slate-50 px-2 py-2 text-left font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300"
              >
                {ck.labels.join(' · ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rowKeys.map((rk, ri) => (
            <tr key={ri} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
              <th
                scope="row"
                className="sticky left-0 z-10 max-w-[220px] truncate border-b border-slate-100 bg-white px-3 py-1.5 text-left font-normal text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                title={rk.labels.join(' · ')}
              >
                {rk.labels.join(' · ')}
              </th>
              {result.columnKeys.map((_ck, ci) => {
                const cell = result.cells[ri]?.[ci] ?? null
                const raw = cell ? cell[value.key] : null
                const style = resolveCellStyle(raw, value.key, rules)
                return (
                  <td
                    key={ci}
                    className={cn(
                      'border-b border-l border-slate-100 px-2 py-1.5 text-center dark:border-slate-800',
                      style.className,
                      !style.className && 'text-slate-600 dark:text-slate-300',
                    )}
                    style={
                      style.backgroundColor ? { backgroundColor: style.backgroundColor } : undefined
                    }
                  >
                    {fmt(raw)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Empty({ message }: { message: string }) {
  return (
    <div className="grid h-full place-items-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
      {message}
    </div>
  )
}
