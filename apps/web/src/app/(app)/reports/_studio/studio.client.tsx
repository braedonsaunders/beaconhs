'use client'

// The report studio — replaces the old single-form builder. Left: numbered
// config sections (data source → columns → filters → shape → chart). Right:
// a sticky live preview that re-runs the report (server action, RLS-scoped,
// row-capped) as the definition changes.
//
// Filters use react-querybuilder for the nested and/or tree UI, restyled via
// controlClassnames to match the design system; its rule JSON is converted
// to/from the engine's ReportRuleGroup shape at the boundary.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { QueryBuilder, type Field, type RuleGroupType, type RuleType } from 'react-querybuilder'
import { Button, Input, Label, Select, Textarea, cn } from '@beaconhs/ui'
import { Loader2, Play } from 'lucide-react'
import type {
  ReportChartType,
  ReportCustomQuery,
  ReportRule,
  ReportRuleGroup,
} from '@beaconhs/db/schema'
import type { ReportEntity, ReportOperatorMeta } from '@beaconhs/reports'
import { ReportChart } from '../_components/report-chart'
import { previewCustomReport, type StudioPreviewResult } from './actions'

const CHART_CHOICES: { key: ReportChartType | 'none'; label: string }[] = [
  { key: 'none', label: 'No chart' },
  { key: 'bar', label: 'Bar' },
  { key: 'line', label: 'Line' },
  { key: 'area', label: 'Area' },
  { key: 'pie', label: 'Pie' },
  { key: 'donut', label: 'Donut' },
]

export function ReportStudio({
  entities,
  operators,
  mode,
  initialName,
  initialDescription,
  initialEntityKey,
  initialQuery,
  cloneFromId,
  action,
}: {
  entities: ReportEntity[]
  operators: ReportOperatorMeta[]
  mode: 'create' | 'edit'
  initialName?: string
  initialDescription?: string
  initialEntityKey?: string | null
  initialQuery?: ReportCustomQuery | null
  cloneFromId?: string | null
  action: (formData: FormData) => Promise<void>
}) {
  const fallbackEntity = entities[0]!.key
  const [entityKey, setEntityKey] = useState<string>(
    initialQuery?.entity ??
      (initialEntityKey && entities.some((e) => e.key === initialEntityKey)
        ? initialEntityKey
        : fallbackEntity),
  )
  const entity = useMemo(() => entities.find((e) => e.key === entityKey)!, [entities, entityKey])

  const [name, setName] = useState(initialName ?? '')
  const [description, setDescription] = useState(initialDescription ?? '')
  const [columns, setColumns] = useState<Set<string>>(
    () =>
      new Set(
        initialQuery?.columns?.length
          ? initialQuery.columns
          : entity.columns.slice(0, 5).map((c) => c.key),
      ),
  )
  const [rqbQuery, setRqbQuery] = useState<RuleGroupType>(() => fromEngineGroup(initialQuery))
  const [groupBy, setGroupBy] = useState<string>(initialQuery?.groupBy ?? '')
  const [sortCol, setSortCol] = useState<string>(
    initialQuery?.sort?.column ?? entity.defaultSort?.column ?? '',
  )
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(
    initialQuery?.sort?.direction ?? entity.defaultSort?.direction ?? 'desc',
  )
  const [limit, setLimit] = useState<number>(initialQuery?.limit ?? 1000)
  const [chartType, setChartType] = useState<ReportChartType | 'none'>(
    initialQuery?.chart?.type ?? 'none',
  )
  const [chartDimension, setChartDimension] = useState<string>(initialQuery?.chart?.dimension ?? '')

  // react-querybuilder assigns random ids to groups/rules, which can never
  // match between SSR and hydration — render it client-only behind a mount
  // gate (the rest of the studio still server-renders).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  function changeEntity(newKey: string) {
    const newEnt = entities.find((e) => e.key === newKey)!
    setEntityKey(newKey)
    setColumns(new Set(newEnt.columns.slice(0, 5).map((c) => c.key)))
    setRqbQuery({ combinator: 'and', rules: [] })
    setGroupBy('')
    setSortCol(newEnt.defaultSort?.column ?? '')
    setSortDir(newEnt.defaultSort?.direction ?? 'desc')
    setChartType('none')
    setChartDimension('')
  }

  function toggleColumn(key: string) {
    setColumns((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const customQuery: ReportCustomQuery = useMemo(() => {
    const filtersV2 = toEngineGroup(rqbQuery, entity)
    return {
      entity: entityKey as ReportCustomQuery['entity'],
      columns: Array.from(columns),
      filters: [],
      filtersV2,
      chart:
        chartType !== 'none' && chartDimension
          ? { type: chartType, dimension: chartDimension, metric: 'count' }
          : null,
      groupBy: groupBy || null,
      sort: sortCol ? { column: sortCol, direction: sortDir } : null,
      limit,
    }
  }, [
    entityKey,
    entity,
    columns,
    rqbQuery,
    groupBy,
    sortCol,
    sortDir,
    limit,
    chartType,
    chartDimension,
  ])

  // --- Live preview ---------------------------------------------------------

  const [preview, setPreview] = useState<StudioPreviewResult | null>(null)
  const [isPreviewing, startPreview] = useTransition()
  const previewKey = useMemo(() => JSON.stringify(customQuery), [customQuery])
  const latest = useRef(previewKey)
  useEffect(() => {
    latest.current = previewKey
    if (columns.size === 0) return
    const t = setTimeout(() => {
      startPreview(async () => {
        const res = await previewCustomReport(JSON.parse(previewKey))
        // Drop stale responses — only the latest config's preview lands.
        if (latest.current === previewKey) setPreview(res)
      })
    }, 600)
    return () => clearTimeout(t)
  }, [previewKey, columns.size])

  const fields: Field[] = useMemo(
    () => entity.columns.map((c) => ({ name: c.key, label: c.label })),
    [entity],
  )
  const getOperators = useMemo(() => {
    return (fieldName: string) => {
      const kind = entity.columns.find((c) => c.key === fieldName)?.kind ?? 'text'
      return operators
        .filter((o) => !o.applicableKinds || o.applicableKinds.includes(kind))
        .map((o) => ({
          name: o.key,
          label: o.label,
          ...(o.needsValue === 'none' ? { arity: 'unary' as const } : {}),
        }))
    }
  }, [entity, operators])

  const canSave = name.trim().length > 0 && columns.size > 0
  const inputCls =
    'h-8 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
  const tinyBtn =
    'inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-700 transition-colors hover:border-teal-400 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* ------------------------------------------------ config column */}
      <form action={action} className="space-y-5 lg:col-span-3">
        <input type="hidden" name="customQuery" value={JSON.stringify(customQuery)} />
        <input type="hidden" name="cloneFromId" value={cloneFromId ?? ''} />

        <Section title="Name">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>
                Report name <span className="text-red-600">*</span>
              </Label>
              <Input
                name="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. High-severity incidents this quarter"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                name="description"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Shown in the report library."
              />
            </div>
          </div>
        </Section>

        <Section step={1} title="Data source">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {entities.map((e) => (
              <button
                key={e.key}
                type="button"
                onClick={() => changeEntity(e.key)}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors',
                  e.key === entityKey
                    ? 'border-teal-700 bg-teal-50 dark:border-teal-500 dark:bg-teal-950/40'
                    : 'border-slate-200 bg-white hover:border-teal-400 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-600',
                )}
              >
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {e.label}
                </div>
                <div className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                  {e.description}
                </div>
              </button>
            ))}
          </div>
        </Section>

        <Section step={2} title="Columns" hint="Shown in the result table and exports.">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {entity.columns.map((c) => (
              <label
                key={c.key}
                className={cn(
                  'flex items-center gap-2 rounded border px-2 py-1.5 text-sm transition-colors',
                  columns.has(c.key)
                    ? 'border-teal-700 bg-teal-50 text-slate-900 dark:border-teal-500 dark:bg-teal-950/40 dark:text-slate-100'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-teal-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300',
                )}
              >
                <input
                  type="checkbox"
                  checked={columns.has(c.key)}
                  onChange={() => toggleColumn(c.key)}
                  className="h-3.5 w-3.5"
                />
                <span className="truncate">{c.label}</span>
              </label>
            ))}
          </div>
        </Section>

        <Section step={3} title="Filters" hint="Combine rules with AND/OR groups.">
          {!mounted ? (
            <div className="h-24 animate-pulse rounded-lg border border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/50" />
          ) : (
            <QueryBuilder
              fields={fields}
              query={rqbQuery}
              onQueryChange={setRqbQuery}
              getOperators={getOperators}
              controlClassnames={{
                queryBuilder: 'space-y-2',
                ruleGroup:
                  'space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-900/50',
                header: 'flex flex-wrap items-center gap-1.5',
                body: 'space-y-1.5',
                rule: 'flex flex-wrap items-center gap-1.5',
                combinators: inputCls,
                fields: cn(inputCls, 'max-w-44'),
                operators: cn(inputCls, 'max-w-44'),
                value: cn(inputCls, 'flex-1 min-w-32'),
                addRule: tinyBtn,
                addGroup: tinyBtn,
                removeRule: cn(tinyBtn, 'hover:border-red-300 hover:text-red-600'),
                removeGroup: cn(tinyBtn, 'hover:border-red-300 hover:text-red-600'),
              }}
              translations={{
                addRule: { label: '+ Rule', title: 'Add rule' },
                addGroup: { label: '+ Group', title: 'Add group' },
                removeRule: { label: '×', title: 'Remove rule' },
                removeGroup: { label: '×', title: 'Remove group' },
              }}
            />
          )}
          <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
            List values are comma-separated.
          </p>
        </Section>

        <Section step={4} title="Shape" hint="Section grouping, ordering, and the row cap.">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Group rows by</Label>
              <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                <option value="">— No grouping —</option>
                {entity.columns.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Sort by</Label>
              <Select value={sortCol} onChange={(e) => setSortCol(e.target.value)}>
                <option value="">— None —</option>
                {entity.columns.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Direction</Label>
              <Select
                value={sortDir}
                onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Row limit</Label>
              <Input
                type="number"
                min={1}
                max={10000}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value) || 1000)}
              />
            </div>
          </div>
        </Section>

        <Section step={5} title="Chart" hint="Optional. Row counts by column value.">
          <div className="flex flex-wrap items-center gap-1.5">
            {CHART_CHOICES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => {
                  setChartType(c.key as ReportChartType | 'none')
                  if (c.key !== 'none' && !chartDimension) {
                    const preferred =
                      entity.columns.find((col) => col.kind === 'enum') ?? entity.columns[0]
                    setChartDimension(preferred?.key ?? '')
                  }
                }}
                className={cn(
                  'inline-flex items-center rounded-full border px-2.5 py-1 text-xs transition-colors',
                  chartType === c.key
                    ? 'border-teal-700 bg-teal-700 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200',
                )}
              >
                {c.label}
              </button>
            ))}
            {chartType !== 'none' ? (
              <Select
                className="ml-2 max-w-52"
                value={chartDimension}
                onChange={(e) => setChartDimension(e.target.value)}
              >
                <option value="">Pick a column…</option>
                {entity.columns.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
        </Section>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <Button type="submit" disabled={!canSave}>
            {mode === 'edit' ? 'Save changes' : 'Save report'}
          </Button>
        </div>
      </form>

      {/* ------------------------------------------------ preview column */}
      <div className="lg:col-span-2">
        <div className="space-y-3 lg:sticky lg:top-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <Play size={14} className="text-teal-600" />
              Live preview
            </h3>
            {isPreviewing ? (
              <span className="flex items-center gap-1.5 text-xs text-slate-400">
                <Loader2 size={12} className="animate-spin" /> running…
              </span>
            ) : preview?.ok ? (
              <span className="text-xs text-slate-400">
                {preview.result.rowCount} row{preview.result.rowCount === 1 ? '' : 's'}
              </span>
            ) : null}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            {!preview ? (
              <p className="py-10 text-center text-sm text-slate-400">
                Preview updates automatically.
              </p>
            ) : !preview.ok ? (
              <p className="py-6 text-center text-sm text-red-600 dark:text-red-400">
                {preview.error}
              </p>
            ) : (
              <div className="space-y-3">
                {preview.result.charts[0] ? (
                  <ReportChart spec={preview.result.charts[0]} height={190} />
                ) : null}
                <PreviewTable groups={preview.result.groups} />
              </div>
            )}
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Preview is limited to 25 rows. Saved reports use the configured row limit.
          </p>
        </div>
      </div>
    </div>
  )
}

function Section({
  step,
  title,
  hint,
  children,
}: {
  step?: number
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex items-baseline gap-2">
        {typeof step === 'number' ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-700 text-[11px] font-semibold text-white">
            {step}
          </span>
        ) : null}
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        {hint ? <span className="text-xs text-slate-400 dark:text-slate-500">{hint}</span> : null}
      </div>
      {children}
    </section>
  )
}

function PreviewTable({
  groups,
}: {
  groups: { title: string; columns: string[]; rows: (string | number | null | undefined)[][] }[]
}) {
  const g = groups[0]
  if (!g || g.rows.length === 0) {
    return <p className="py-4 text-center text-xs text-slate-400">No rows matched.</p>
  }
  const rows = g.rows.slice(0, 8)
  const cols = g.columns.slice(0, 5)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {cols.map((c) => (
              <th key={c} className="py-1.5 pr-3 font-medium whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
              {cols.map((_, ci) => (
                <td
                  key={ci}
                  className="max-w-40 truncate py-1.5 pr-3 text-slate-700 dark:text-slate-300"
                >
                  {row[ci] === null || typeof row[ci] === 'undefined' || row[ci] === ''
                    ? '—'
                    : String(row[ci])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {groups.length > 1 ? (
        <p className="mt-1.5 text-[11px] text-slate-400">
          +{groups.length - 1} more section{groups.length === 2 ? '' : 's'} when grouped.
        </p>
      ) : null}
    </div>
  )
}

// --- RQB ⇄ engine conversion -------------------------------------------------

/** react-querybuilder rule JSON → the engine's stored ReportRuleGroup. Values
 *  are coerced per operator/column kind (comma lists, day counts, numbers). */
function toEngineGroup(group: RuleGroupType, entity: ReportEntity): ReportRuleGroup | null {
  function walkGroup(g: RuleGroupType): ReportRuleGroup {
    const rules: (ReportRule | ReportRuleGroup)[] = []
    for (const r of g.rules) {
      if (typeof r === 'string') continue // independent-combinator mode unused
      if ('rules' in r) {
        const sub = walkGroup(r as RuleGroupType)
        if (sub.rules.length) rules.push(sub)
        continue
      }
      const rule = r as RuleType
      if (!rule.field || !rule.operator) continue
      rules.push({
        field: rule.field,
        op: rule.operator as ReportRule['op'],
        value: coerceValue(rule.operator, rule.field, rule.value),
      })
    }
    return { combinator: g.combinator === 'or' ? 'or' : 'and', rules }
  }

  function coerceValue(op: string, field: string, raw: unknown): ReportRule['value'] {
    const kind = entity.columns.find((c) => c.key === field)?.kind ?? 'text'
    if (op === 'is_null' || op === 'is_not_null') return null
    const s = String(raw ?? '').trim()
    if (op === 'in' || op === 'not_in') {
      return s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    }
    if (op === 'between_days_ago') {
      const n = Number(s)
      return Number.isFinite(n) ? n : 30
    }
    if ((op === 'gte' || op === 'lte' || op === 'eq' || op === 'neq') && kind === 'number') {
      const n = Number(s)
      if (Number.isFinite(n) && s !== '') return n
    }
    return s
  }

  const out = walkGroup(group)
  return out.rules.length ? out : null
}

/** Stored plan → react-querybuilder state. Migrates v1 flat filters when no
 *  v2 tree exists so older definitions open cleanly in the studio. */
function fromEngineGroup(q: ReportCustomQuery | null | undefined): RuleGroupType {
  if (q?.filtersV2 && q.filtersV2.rules.length) {
    return walk(q.filtersV2)
  }
  if (q?.filters?.length) {
    return {
      combinator: 'and',
      rules: q.filters.map((f) => ({
        field: f.column,
        operator: f.op,
        value: displayValue(f.value),
      })),
    }
  }
  return { combinator: 'and', rules: [] }

  function walk(g: ReportRuleGroup): RuleGroupType {
    return {
      combinator: g.combinator,
      rules: g.rules.map((r) =>
        'rules' in r
          ? walk(r as ReportRuleGroup)
          : {
              field: (r as ReportRule).field,
              operator: (r as ReportRule).op,
              value: displayValue((r as ReportRule).value),
            },
      ),
    }
  }

  function displayValue(v: ReportRule['value']): string {
    if (v === null || typeof v === 'undefined') return ''
    if (Array.isArray(v)) return v.join(', ')
    return String(v)
  }
}
