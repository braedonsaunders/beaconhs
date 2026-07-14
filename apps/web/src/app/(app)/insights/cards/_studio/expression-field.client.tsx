'use client'

// A formula editor: a monospace field that parses live (via the clean-room
// expression parser), shows inline validity/errors, and offers a click-to-insert
// palette of the entity's fields + the function library. Produces a formula
// string; the builder parses it to a BhqlExpr on save.

import { useMemo, useRef, useState } from 'react'
import { EXPR_FN_HELP, EXPR_SCALAR_FNS, parseExpression } from '@beaconhs/analytics'
import { cn } from '@beaconhs/ui'
import {
  filterInsightsExpressionFields,
  insightsExpressionFieldLabel,
  type InsightsExpressionField,
} from '@/lib/insights-expression-fields'

const FN_PALETTE = [
  'count',
  'count_distinct',
  'sum',
  'avg',
  'min',
  'max',
  'datediff',
  'datepart',
  'datetrunc',
  'case',
  'if',
  ...EXPR_SCALAR_FNS,
].filter((v, i, a) => a.indexOf(v) === i)

/** Build the label⇄key map the parser uses to resolve [Column] references. A
 *  related field can be referenced as "[Label]" or "[Relation → Label]". */
export const exprLabel = insightsExpressionFieldLabel

export function ExpressionField({
  value,
  onChange,
  fields,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  fields: InsightsExpressionField[]
  placeholder?: string
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [showPalette, setShowPalette] = useState(false)
  const [fieldQuery, setFieldQuery] = useState('')

  const resolveColumn = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of fields) {
      m.set(f.label.trim().toLowerCase(), f.value)
      m.set(exprLabel(f).trim().toLowerCase(), f.value)
    }
    return (label: string) => m.get(label.trim().toLowerCase()) ?? null
  }, [fields])

  const parsed = useMemo(
    () => (value.trim() ? parseExpression(value, { resolveColumn }) : null),
    [value, resolveColumn],
  )
  const error = parsed && !parsed.ok ? parsed.error : null
  const requireSearch = fields.length > 80 && !fieldQuery.trim()
  const visibleFields = useMemo(
    () => (requireSearch ? [] : filterInsightsExpressionFields(fields, fieldQuery)),
    [fieldQuery, fields, requireSearch],
  )

  const insert = (text: string) => {
    const ta = taRef.current
    const start = ta?.selectionStart ?? value.length
    const end = ta?.selectionEnd ?? value.length
    onChange(value.slice(0, start) + text + value.slice(end))
    requestAnimationFrame(() => {
      ta?.focus()
      const pos = start + text.length
      ta?.setSelectionRange(pos, pos)
    })
  }

  return (
    <div className="space-y-1">
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'datediff("day", max([Occurred at]), now())'}
        rows={2}
        spellCheck={false}
        className={cn(
          'w-full resize-y rounded-md border bg-white px-2 py-1.5 font-mono text-xs leading-5 outline-none focus:ring-2 dark:bg-slate-900 dark:text-slate-100',
          error
            ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20'
            : 'border-slate-300 focus:border-teal-500 focus:ring-teal-500/20 dark:border-slate-700',
        )}
      />
      <div className="flex items-center justify-between">
        {error ? (
          <p className="text-[11px] text-rose-600 dark:text-rose-400">{error}</p>
        ) : value.trim() ? (
          <p className="text-[11px] text-teal-600 dark:text-teal-400">✓ valid expression</p>
        ) : (
          <span className="text-[11px] text-slate-400">
            Type a formula, or insert from the palette →
          </span>
        )}
        <button
          type="button"
          onClick={() => setShowPalette((s) => !s)}
          className="text-[11px] font-medium text-teal-600 hover:text-teal-700 dark:text-teal-400"
        >
          {showPalette ? 'Hide palette' : 'ƒ Fields & functions'}
        </button>
      </div>
      {showPalette ? (
        <div className="max-h-44 space-y-1.5 overflow-auto rounded-md border border-slate-200 bg-slate-50/60 p-1.5 dark:border-slate-800 dark:bg-slate-800/30">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
              Fields
            </div>
            <span className="text-[10px] text-slate-400">
              {visibleFields.length} of {fields.length}
            </span>
          </div>
          <input
            type="search"
            value={fieldQuery}
            onChange={(event) => setFieldQuery(event.target.value.slice(0, 100))}
            placeholder="Search fields or related tables…"
            aria-label="Search expression fields"
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          />
          <div className="flex flex-wrap gap-1">
            {visibleFields.map((f) => (
              <button
                key={f.value}
                type="button"
                title={exprLabel(f)}
                onClick={() => insert(`[${exprLabel(f)}]`)}
                className="rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-700 ring-1 ring-slate-200 hover:bg-teal-50 hover:text-teal-700 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
              >
                {f.label}
              </button>
            ))}
            {requireSearch ? (
              <p className="w-full py-2 text-center text-[11px] text-slate-500 dark:text-slate-400">
                Type a field or related-table name to search all {fields.length} fields.
              </p>
            ) : visibleFields.length === 0 ? (
              <p className="w-full py-2 text-center text-[11px] text-slate-500 dark:text-slate-400">
                No fields match this search.
              </p>
            ) : null}
          </div>
          <div className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
            Functions
          </div>
          <div className="flex flex-wrap gap-1">
            {FN_PALETTE.map((fn) => (
              <button
                key={fn}
                type="button"
                title={
                  EXPR_FN_HELP[fn]?.sig ? `${EXPR_FN_HELP[fn]!.sig} — ${EXPR_FN_HELP[fn]!.doc}` : fn
                }
                onClick={() => insert(fn === 'now' ? 'now()' : `${fn}(`)}
                className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-violet-700 ring-1 ring-slate-200 hover:bg-violet-50 dark:bg-slate-900 dark:text-violet-300 dark:ring-slate-700"
              >
                {fn}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
