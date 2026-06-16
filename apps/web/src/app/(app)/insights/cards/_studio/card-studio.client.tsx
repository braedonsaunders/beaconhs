'use client'

// The visual query builder. LEFT 1/3 rail = authoring steps (source → summarize →
// group-bys → measures → filters → pivot → visualize); RIGHT 2/3 = live preview.
// Scoped entirely to the curated entity + semantic registry — no raw SQL. Builds
// a BHQL AST, previews it (debounced, under RLS) and saves it as a Card.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, BarChart3, Loader2, Plus, Save, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, cn } from '@beaconhs/ui'
import {
  VIZ_LIST,
  type AnalyticsColumn,
  type AnalyticsEntity,
  type BhqlResult,
  type VizKey,
} from '@beaconhs/analytics'
import type {
  BhqlAggFn,
  BhqlAnyMeasure,
  BhqlBin,
  BhqlMeasure,
  BhqlQuery,
  ReportRuleGroup,
} from '@beaconhs/db/schema'
import { VizRenderer } from '../../_viz/viz-renderer.client'
import { VizIcon } from '../../_viz/viz-icon'
import { createCard, generateCard, previewCard, updateCard } from '../_actions'

type Mode = 'rows' | 'summarize'
type FilterOp = 'eq' | 'neq' | 'contains' | 'gte' | 'lte' | 'in' | 'is_null' | 'is_not_null'
type FilterRow = { field: string; op: FilterOp; value: string }
type BreakoutRow = { field: string; bin?: BhqlBin }
type MeasureWhere = { field: string; op: FilterOp; value: string }
type MeasureRow = {
  fn: BhqlAggFn
  field?: string
  /** Conditional aggregate — only count/sum rows matching this single condition. */
  where?: MeasureWhere
  /** When true this is a ratio: (numerator agg above) ÷ (denominator agg) × multiplier. */
  calc?: boolean
  denFn?: BhqlAggFn
  denField?: string
  denWhere?: MeasureWhere
  multiplier?: number
}

const FILTER_OPS: { value: FilterOp; label: string; needsValue: boolean }[] = [
  { value: 'eq', label: 'equals', needsValue: true },
  { value: 'neq', label: 'not equals', needsValue: true },
  { value: 'contains', label: 'contains', needsValue: true },
  { value: 'gte', label: '≥', needsValue: true },
  { value: 'lte', label: '≤', needsValue: true },
  { value: 'in', label: 'is any of (comma-sep)', needsValue: true },
  { value: 'is_null', label: 'is empty', needsValue: false },
  { value: 'is_not_null', label: 'is set', needsValue: false },
]

const AGG_FNS: { value: BhqlAggFn; label: string }[] = [
  { value: 'count', label: 'Count of rows' },
  { value: 'sum', label: 'Sum of' },
  { value: 'avg', label: 'Average of' },
  { value: 'min', label: 'Min of' },
  { value: 'max', label: 'Max of' },
  { value: 'count_distinct', label: 'Distinct count of' },
]

const selectCls =
  'h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
const inputCls = selectCls
const sectionCls =
  'rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900'
const headCls =
  'mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400'

function slug(s: string): string {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+/, '')
    .slice(0, 40)
  return /^[a-z]/.test(out) ? out : `f_${out}`.slice(0, 40)
}

function coerceValue(value: string, op: FilterOp): string | number | string[] | null {
  if (op === 'is_null' || op === 'is_not_null') return null
  if (op === 'in')
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  if (op === 'gte' || op === 'lte') {
    const n = Number(value)
    return Number.isFinite(n) ? n : value
  }
  return value
}

export type CardStudioInitial = {
  id?: string
  name: string
  query: BhqlQuery | null
  vizType: string
}

export function CardStudio({
  initial,
  entities,
}: {
  initial: CardStudioInitial
  entities: AnalyticsEntity[]
}) {
  const router = useRouter()
  const entityMap = useMemo(() => Object.fromEntries(entities.map((e) => [e.key, e])), [entities])
  // Group for the picker: each category an optgroup, in discovery order (primary first).
  const entityGroups = useMemo(() => {
    const m = new Map<string, AnalyticsEntity[]>()
    for (const e of entities) {
      const arr = m.get(e.category) ?? []
      arr.push(e)
      m.set(e.category, arr)
    }
    return [...m.entries()]
  }, [entities])

  const decoded = useMemo(() => decodeQuery(initial.query), [initial.query])

  const [name, setName] = useState(initial.name)
  const [entityKey, setEntityKey] = useState(decoded.entityKey ?? entities[0]?.key ?? 'incidents')
  const [mode, setMode] = useState<Mode>(decoded.mode)
  const [columns, setColumns] = useState<string[]>(decoded.columns)
  const [breakouts, setBreakouts] = useState<BreakoutRow[]>(decoded.breakouts)
  const [measures, setMeasures] = useState<MeasureRow[]>(decoded.measures)
  const [filters, setFilters] = useState<FilterRow[]>(decoded.filters)
  const [pivotOn, setPivotOn] = useState(decoded.pivotOn)
  const [vizType, setVizType] = useState<string>(initial.vizType || 'table')
  const [vizTouched, setVizTouched] = useState(Boolean(initial.id))
  const [suggestedViz, setSuggestedViz] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  const entity = entityMap[entityKey]
  const cols = entity?.columns ?? []

  const ast = useMemo<BhqlQuery>(() => {
    const filter: ReportRuleGroup | null = filters.length
      ? {
          combinator: 'and',
          rules: filters
            .filter(
              (f) => f.field && (f.op === 'is_null' || f.op === 'is_not_null' || f.value !== ''),
            )
            .map((f) => ({ field: f.field, op: f.op, value: coerceValue(f.value, f.op) })),
        }
      : null

    if (mode === 'rows') {
      return {
        version: 'bhql/1',
        display: 'table',
        pivot: null,
        stages: [
          {
            source: entityKey as never,
            filter,
            columns: columns.length ? columns : cols.slice(0, 6).map((c) => c.key),
            limit: 500,
          },
        ],
      }
    }

    const used = new Set<string>()
    const uniq = (base: string) => {
      let a = slug(base) || 'x'
      let i = 1
      while (used.has(a)) a = `${slug(base)}_${i++}`.slice(0, 40)
      used.add(a)
      return a
    }
    const bks = breakouts
      .filter((b) => b.field)
      .map((b) => ({ field: b.field, alias: uniq(b.field), bin: b.bin }))
    const whereToGroup = (w?: MeasureWhere): ReportRuleGroup | undefined => {
      if (!w || !w.field) return undefined
      const needsValue = w.op !== 'is_null' && w.op !== 'is_not_null'
      if (needsValue && w.value === '') return undefined
      return {
        combinator: 'and',
        rules: [{ field: w.field, op: w.op, value: coerceValue(w.value, w.op) }],
      }
    }
    const mss: BhqlAnyMeasure[] = []
    const outputAliases: string[] = []
    for (const m of measures) {
      if (m.calc) {
        const numAlias = uniq('num')
        mss.push({
          fn: m.fn,
          field: m.fn === 'count' ? undefined : m.field,
          alias: numAlias,
          filter: whereToGroup(m.where),
        })
        let denAlias: string | undefined
        if (m.denFn) {
          denAlias = uniq('den')
          mss.push({
            fn: m.denFn,
            field: m.denFn === 'count' ? undefined : m.denField,
            alias: denAlias,
            filter: whereToGroup(m.denWhere),
          })
        }
        const calcAlias = uniq('ratio')
        mss.push({
          kind: 'calc',
          alias: calcAlias,
          numerator: numAlias,
          denominator: denAlias,
          multiplier: m.multiplier,
        })
        outputAliases.push(calcAlias)
      } else if (m.fn === 'count' || m.field) {
        const a = uniq(m.fn === 'count' ? 'count' : `${m.fn}_${m.field}`)
        mss.push({
          fn: m.fn,
          field: m.fn === 'count' ? undefined : m.field,
          alias: a,
          filter: whereToGroup(m.where),
        })
        outputAliases.push(a)
      }
    }

    const canPivot = pivotOn && bks.length >= 2 && outputAliases.length >= 1
    const pivot = canPivot
      ? {
          rows: [{ breakout: bks[0]!.alias }],
          columns: [{ breakout: bks[1]!.alias }],
          values: outputAliases.map((a) => ({ measure: a })),
        }
      : null

    return {
      version: 'bhql/1',
      display: canPivot ? 'pivot' : 'table',
      pivot,
      stages: [
        { source: entityKey as never, filter, breakouts: bks, aggregations: mss, limit: 2000 },
      ],
    }
  }, [entityKey, mode, columns, breakouts, measures, filters, pivotOn, cols])

  // Debounced live preview (drops stale responses).
  const [result, setResult] = useState<BhqlResult | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const latest = useRef(0)

  // Depend on a STABLE string key (not the object identity) so the debounce
  // timer isn't cleared+reset on every render — otherwise the preview can hang.
  const astKey = useMemo(() => JSON.stringify(ast), [ast])
  useEffect(() => {
    const key = ++latest.current
    setPreviewing(true)
    const t = setTimeout(async () => {
      try {
        const r = await previewCard({ query: ast })
        if (key !== latest.current) return
        setPreviewing(false)
        if (r.ok) {
          setResult(r.result)
          setPreviewError(null)
          setSuggestedViz(r.suggestedViz)
          if (!vizTouched) setVizType(r.suggestedViz)
        } else {
          setPreviewError(r.error)
        }
      } catch (e) {
        if (key !== latest.current) return
        setPreviewing(false)
        setPreviewError(e instanceof Error ? e.message : 'Preview failed to run.')
      }
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [astKey, vizTouched])

  // Ask AI: NL prompt → BHQL, hydrated into builder state via the same decoder
  // edit-mode uses. The query is left fully editable; the live preview re-runs
  // automatically once state changes.
  async function askAi() {
    const p = aiPrompt.trim()
    if (!p || aiLoading) return
    setAiLoading(true)
    try {
      const r = await generateCard(p)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      const d = decodeQuery(r.query)
      setEntityKey(d.entityKey ?? entityKey)
      setMode(d.mode)
      setColumns(d.columns)
      setBreakouts(d.breakouts)
      setMeasures(d.measures)
      setFilters(d.filters)
      setPivotOn(d.pivotOn)
      setVizType(r.suggestedViz)
      setVizTouched(false)
      if (!name.trim() || name === 'Untitled card') {
        setName(p.charAt(0).toUpperCase() + p.slice(1, 80))
      }
      toast.success('Built from your prompt — refine it on the left.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not reach the AI.')
    } finally {
      setAiLoading(false)
    }
  }

  async function save() {
    setSaving(true)
    const payload = { name, query: ast, vizType, vizSettings: {} }
    const r = initial.id
      ? await updateCard({ id: initial.id, ...payload })
      : await createCard(payload)
    setSaving(false)
    if (!r.ok) {
      toast.error(r.error)
      return
    }
    toast.success(initial.id ? 'Card updated' : 'Card created')
    const targetId = initial.id ?? ('id' in r ? r.id : '')
    router.push(`/insights/cards/${targetId}`)
    router.refresh()
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50/40 dark:bg-slate-950">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
        <Link
          href="/insights/library"
          className="flex h-9 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          <ArrowLeft size={14} /> Library
        </Link>
        <BarChart3 size={16} className="text-teal-600" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Card name"
          className="h-9 flex-1 rounded-md border border-transparent px-2 text-sm font-semibold outline-none hover:border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:text-slate-100 dark:hover:border-slate-700"
        />
        <Button
          type="button"
          onClick={save}
          disabled={saving || !name.trim()}
          className="h-9 text-xs"
        >
          {saving ? (
            <Loader2 size={14} className="mr-1 animate-spin" />
          ) : (
            <Save size={14} className="mr-1" />
          )}
          Save card
        </Button>
      </div>

      {/* Ask AI — natural language → BHQL, loaded into the builder below. */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-teal-50/40 px-4 py-2 dark:border-slate-800 dark:bg-teal-500/5">
        <Sparkles size={15} className="shrink-0 text-teal-500" />
        <input
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void askAi()
            }
          }}
          placeholder="Ask AI to build this chart — e.g. “incidents by month this year”"
          disabled={aiLoading}
          className="h-9 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <Button
          type="button"
          onClick={() => void askAi()}
          disabled={aiLoading || !aiPrompt.trim()}
          className="h-9 text-xs"
        >
          {aiLoading ? (
            <Loader2 size={14} className="mr-1 animate-spin" />
          ) : (
            <Sparkles size={14} className="mr-1" />
          )}
          Ask AI
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-3 lg:overflow-hidden">
        {/* LEFT rail */}
        <div className="app-scroll space-y-3 lg:col-span-1 lg:min-h-0 lg:overflow-y-auto">
          {/* Source */}
          <div className={sectionCls}>
            <h3 className={headCls}>Data</h3>
            <select
              value={entityKey}
              onChange={(e) => setEntityKey(e.target.value)}
              className={selectCls}
            >
              {entityGroups.map(([cat, ents]) => (
                <optgroup key={cat} label={cat}>
                  {ents.map((en) => (
                    <option key={en.key} value={en.key}>
                      {en.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {entity?.description ? (
              <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                {entity.description}
              </p>
            ) : null}
            <div className="mt-3 inline-flex rounded-md border border-slate-200 p-0.5 dark:border-slate-700">
              {(['rows', 'summarize'] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    'rounded px-3 py-1 text-xs font-medium capitalize transition',
                    mode === m
                      ? 'bg-teal-600 text-white'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400',
                  )}
                >
                  {m === 'rows' ? 'Raw rows' : 'Summarize'}
                </button>
              ))}
            </div>
          </div>

          {mode === 'rows' ? (
            <div className={sectionCls}>
              <h3 className={headCls}>Columns</h3>
              <div className="grid grid-cols-1 gap-1">
                {cols.map((c) => (
                  <label
                    key={c.key}
                    className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300"
                  >
                    <input
                      type="checkbox"
                      checked={columns.includes(c.key)}
                      onChange={(e) =>
                        setColumns((cs) =>
                          e.target.checked ? [...cs, c.key] : cs.filter((k) => k !== c.key),
                        )
                      }
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <>
              <RailList
                title="Group by"
                items={breakouts}
                onAdd={() => setBreakouts((b) => [...b, { field: cols[0]?.key ?? '' }])}
                onRemove={(i) => setBreakouts((b) => b.filter((_, j) => j !== i))}
                render={(b, i) => (
                  <BreakoutEditor
                    cols={cols}
                    row={b}
                    onChange={(next) =>
                      setBreakouts((bs) => bs.map((x, j) => (j === i ? next : x)))
                    }
                  />
                )}
              />
              <RailList
                title="Measures"
                items={measures}
                onAdd={() => setMeasures((m) => [...m, { fn: 'count' }])}
                onRemove={(i) => setMeasures((m) => m.filter((_, j) => j !== i))}
                render={(m, i) => (
                  <MeasureEditor
                    cols={cols}
                    row={m}
                    onChange={(next) => setMeasures((ms) => ms.map((x, j) => (j === i ? next : x)))}
                  />
                )}
              />
              {breakouts.length >= 2 && measures.length >= 1 ? (
                <div className={sectionCls}>
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={pivotOn}
                      onChange={(e) => setPivotOn(e.target.checked)}
                    />
                    Pivot — rows ={' '}
                    {cols.find((c) => c.key === breakouts[0]?.field)?.label ?? '1st group'}, columns
                    = {cols.find((c) => c.key === breakouts[1]?.field)?.label ?? '2nd group'}
                  </label>
                </div>
              ) : null}
            </>
          )}

          {/* Filters */}
          <RailList
            title="Filters"
            items={filters}
            onAdd={() =>
              setFilters((f) => [...f, { field: cols[0]?.key ?? '', op: 'eq', value: '' }])
            }
            onRemove={(i) => setFilters((f) => f.filter((_, j) => j !== i))}
            render={(f, i) => (
              <FilterEditor
                cols={cols}
                row={f}
                onChange={(next) => setFilters((fs) => fs.map((x, j) => (j === i ? next : x)))}
              />
            )}
          />

          {/* Visualize */}
          <div className={sectionCls}>
            <h3 className={headCls}>Visualize</h3>
            <div className="grid grid-cols-4 gap-1.5">
              {VIZ_LIST.map((v) => {
                const isSuggested = v.key === suggestedViz
                return (
                  <button
                    key={v.key}
                    type="button"
                    title={isSuggested ? `${v.label} — suggested` : v.label}
                    onClick={() => {
                      setVizType(v.key)
                      setVizTouched(true)
                    }}
                    className={cn(
                      'relative flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-[10px] transition',
                      vizType === v.key
                        ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300'
                        : isSuggested
                          ? 'border-teal-300/70 text-slate-500 hover:border-teal-400 dark:border-teal-500/30 dark:text-slate-400'
                          : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400',
                    )}
                  >
                    {isSuggested && vizType !== v.key ? (
                      <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-teal-400" />
                    ) : null}
                    <VizIcon iconKey={v.iconKey} size={15} />
                    <span className="truncate">{v.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* RIGHT preview */}
        <div className="min-h-0 lg:col-span-2">
          <div className="flex min-h-[60vh] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-3 lg:h-full lg:min-h-0 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Sparkles size={13} className="text-teal-500" />
              Live preview
              {previewing ? <Loader2 size={12} className="animate-spin" /> : null}
              {result ? (
                <span className="ml-auto">
                  {result.rowCount} rows{result.truncated ? ' (capped)' : ''}
                </span>
              ) : null}
            </div>
            <div className="min-h-0 flex-1">
              {previewError ? (
                <div className="grid h-full place-items-center rounded-lg border border-dashed border-rose-300 bg-rose-50/40 px-4 text-center text-xs text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/5 dark:text-rose-400">
                  {previewError}
                </div>
              ) : result ? (
                <VizRenderer vizType={vizType} result={result} label={name} />
              ) : (
                <div className="grid h-full place-items-center text-xs text-slate-400">
                  Building preview…
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// --- rail building blocks ---------------------------------------------------

function RailList<T>({
  title,
  items,
  onAdd,
  onRemove,
  render,
}: {
  title: string
  items: T[]
  onAdd: () => void
  onRemove: (i: number) => void
  render: (item: T, i: number) => React.ReactNode
}) {
  return (
    <div className={sectionCls}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className={cn(headCls, 'mb-0')}>{title}</h3>
        <button type="button" onClick={onAdd} className="text-teal-600 hover:text-teal-700">
          <Plus size={15} />
        </button>
      </div>
      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="text-[11px] text-slate-400 dark:text-slate-500">None.</p>
        ) : (
          items.map((it, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <div className="flex-1">{render(it, i)}</div>
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="mt-1 text-slate-300 hover:text-rose-500"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function BreakoutEditor({
  cols,
  row,
  onChange,
}: {
  cols: AnalyticsColumn[]
  row: BreakoutRow
  onChange: (next: BreakoutRow) => void
}) {
  const col = cols.find((c) => c.key === row.field)
  return (
    <div className="space-y-1">
      <select
        value={row.field}
        onChange={(e) => onChange({ ...row, field: e.target.value, bin: undefined })}
        className={selectCls}
      >
        {cols.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>
      {col?.canBinTemporal ? (
        <select
          value={row.bin?.kind === 'temporal' ? row.bin.unit : ''}
          onChange={(e) =>
            onChange({
              ...row,
              bin: e.target.value ? { kind: 'temporal', unit: e.target.value as never } : undefined,
            })
          }
          className={cn(selectCls, 'h-8 text-xs')}
        >
          <option value="">No bucket</option>
          {['day', 'week', 'month', 'quarter', 'year'].map((u) => (
            <option key={u} value={u}>
              by {u}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  )
}

function fieldOptionsFor(cols: AnalyticsColumn[], fn: BhqlAggFn): AnalyticsColumn[] {
  return fn === 'sum' || fn === 'avg' ? cols.filter((c) => c.canMeasure) : cols
}

function ConditionRow({
  cols,
  where,
  onChange,
}: {
  cols: AnalyticsColumn[]
  where?: MeasureWhere
  onChange: (w: MeasureWhere | undefined) => void
}) {
  if (!where) {
    return (
      <button
        type="button"
        onClick={() => onChange({ field: cols[0]?.key ?? '', op: 'eq', value: '' })}
        className="text-[11px] font-medium text-teal-600 hover:text-teal-700"
      >
        + only where…
      </button>
    )
  }
  const op = FILTER_OPS.find((o) => o.value === where.op)
  return (
    <div className="space-y-1 rounded bg-slate-50 p-1 dark:bg-slate-800/40">
      <div className="flex items-center justify-between">
        <span className="text-[10px] tracking-wide text-slate-400 uppercase">only where</span>
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="text-slate-300 hover:text-rose-500"
        >
          <Trash2 size={11} />
        </button>
      </div>
      <select
        value={where.field}
        onChange={(e) => onChange({ ...where, field: e.target.value })}
        className={cn(selectCls, 'h-7 text-xs')}
      >
        {cols.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>
      <div className="flex gap-1">
        <select
          value={where.op}
          onChange={(e) => onChange({ ...where, op: e.target.value as FilterOp })}
          className={cn(selectCls, 'h-7 flex-1 text-xs')}
        >
          {FILTER_OPS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {op?.needsValue ? (
          <input
            value={where.value}
            onChange={(e) => onChange({ ...where, value: e.target.value })}
            placeholder="value"
            className={cn(inputCls, 'h-7 flex-1 text-xs')}
          />
        ) : null}
      </div>
    </div>
  )
}

function MeasureEditor({
  cols,
  row,
  onChange,
}: {
  cols: AnalyticsColumn[]
  row: MeasureRow
  onChange: (next: MeasureRow) => void
}) {
  return (
    <div className="space-y-1.5">
      <select
        value={row.fn}
        onChange={(e) => onChange({ ...row, fn: e.target.value as BhqlAggFn })}
        className={selectCls}
      >
        {AGG_FNS.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </select>
      {row.fn !== 'count' ? (
        <select
          value={row.field ?? ''}
          onChange={(e) => onChange({ ...row, field: e.target.value })}
          className={cn(selectCls, 'h-8 text-xs')}
        >
          <option value="">Pick a field…</option>
          {fieldOptionsFor(cols, row.fn).map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      ) : null}
      <ConditionRow
        cols={cols}
        where={row.where}
        onChange={(w) => onChange({ ...row, where: w })}
      />

      <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400">
        <input
          type="checkbox"
          checked={!!row.calc}
          onChange={(e) =>
            onChange({
              ...row,
              calc: e.target.checked,
              denFn: e.target.checked ? (row.denFn ?? 'count') : undefined,
              multiplier: e.target.checked ? (row.multiplier ?? 100) : undefined,
            })
          }
        />
        Make it a ratio (÷ another measure)
      </label>
      {row.calc ? (
        <div className="space-y-1 rounded-md bg-slate-50 p-1.5 dark:bg-slate-800/40">
          <div className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
            ÷ denominator
          </div>
          <select
            value={row.denFn ?? 'count'}
            onChange={(e) => onChange({ ...row, denFn: e.target.value as BhqlAggFn })}
            className={cn(selectCls, 'h-8 text-xs')}
          >
            {AGG_FNS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          {row.denFn && row.denFn !== 'count' ? (
            <select
              value={row.denField ?? ''}
              onChange={(e) => onChange({ ...row, denField: e.target.value })}
              className={cn(selectCls, 'h-8 text-xs')}
            >
              <option value="">Pick a field…</option>
              {fieldOptionsFor(cols, row.denFn).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          ) : null}
          <ConditionRow
            cols={cols}
            where={row.denWhere}
            onChange={(w) => onChange({ ...row, denWhere: w })}
          />
          <select
            value={String(row.multiplier ?? 1)}
            onChange={(e) => onChange({ ...row, multiplier: Number(e.target.value) })}
            className={cn(selectCls, 'h-8 text-xs')}
          >
            <option value="1">ratio (×1)</option>
            <option value="100">percentage (×100)</option>
            <option value="200000">rate per 200,000 hrs</option>
          </select>
        </div>
      ) : null}
    </div>
  )
}

function FilterEditor({
  cols,
  row,
  onChange,
}: {
  cols: AnalyticsColumn[]
  row: FilterRow
  onChange: (next: FilterRow) => void
}) {
  const op = FILTER_OPS.find((o) => o.value === row.op)
  return (
    <div className="space-y-1">
      <select
        value={row.field}
        onChange={(e) => onChange({ ...row, field: e.target.value })}
        className={cn(selectCls, 'h-8 text-xs')}
      >
        {cols.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>
      <div className="flex gap-1">
        <select
          value={row.op}
          onChange={(e) => onChange({ ...row, op: e.target.value as FilterOp })}
          className={cn(selectCls, 'h-8 flex-1 text-xs')}
        >
          {FILTER_OPS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {op?.needsValue ? (
          <input
            value={row.value}
            onChange={(e) => onChange({ ...row, value: e.target.value })}
            placeholder="value"
            className={cn(inputCls, 'h-8 flex-1 text-xs')}
          />
        ) : null}
      </div>
    </div>
  )
}

// --- AST → builder state (edit mode) ---------------------------------------

function groupToWhere(g?: ReportRuleGroup | null): MeasureWhere | undefined {
  const r = g?.rules?.[0]
  if (r && typeof r === 'object' && 'field' in r) {
    const rr = r as { field: string; op: string; value?: unknown }
    return {
      field: rr.field,
      op: rr.op as FilterOp,
      value: Array.isArray(rr.value)
        ? rr.value.join(', ')
        : rr.value == null
          ? ''
          : String(rr.value),
    }
  }
  return undefined
}

function decodeQuery(query: BhqlQuery | null): {
  entityKey?: string
  mode: Mode
  columns: string[]
  breakouts: BreakoutRow[]
  measures: MeasureRow[]
  filters: FilterRow[]
  pivotOn: boolean
} {
  const stage = query?.stages?.[0]
  if (!stage) {
    return {
      mode: 'summarize',
      columns: [],
      breakouts: [],
      measures: [],
      filters: [],
      pivotOn: false,
    }
  }
  const filters: FilterRow[] = []
  for (const r of stage.filter?.rules ?? []) {
    if (r && typeof r === 'object' && 'field' in r) {
      const op = (r as { op: string }).op as FilterOp
      const value = (r as { value?: unknown }).value
      filters.push({
        field: (r as { field: string }).field,
        op,
        value: Array.isArray(value) ? value.join(', ') : value == null ? '' : String(value),
      })
    }
  }
  const breakouts = (stage.breakouts ?? []).map((b) => ({ field: b.field, bin: b.bin }))
  const measures = (stage.aggregations ?? [])
    .filter((m): m is BhqlMeasure => (m as { kind?: string }).kind !== 'calc')
    .map((m) => ({ fn: m.fn, field: m.field, where: groupToWhere(m.filter) }))
  const isSummarize = breakouts.length > 0 || measures.length > 0
  return {
    entityKey: stage.source,
    mode: isSummarize ? 'summarize' : 'rows',
    columns: stage.columns ?? [],
    breakouts,
    measures,
    filters,
    pivotOn: query?.display === 'pivot' && Boolean(query.pivot),
  }
}
