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
  parseExpression,
  serializeExpression,
  type AnalyticsColumn,
  type AnalyticsEntity,
  type BhqlResult,
  type VizKey,
} from '@beaconhs/analytics'
import type {
  AiCardOutputShape,
  BhqlAggFn,
  BhqlAnyMeasure,
  BhqlBin,
  BhqlBreakout,
  BhqlExpr,
  BhqlExprMeasure,
  BhqlJoinedSource,
  BhqlMeasure,
  BhqlMetricRef,
  BhqlQuery,
  InsightCardConfig,
  ReportRuleGroup,
} from '@beaconhs/db/schema'
import { ExpressionField, exprLabel, type ExprField } from './expression-field.client'
import { VizRenderer } from '../../_viz/viz-renderer.client'
import { VizIcon } from '../../_viz/viz-icon'
import { createCard, generateCard, previewCard, updateCard } from '../_actions'

type Mode = 'rows' | 'summarize' | 'matrix'

/** A guided coverage matrix: two dimension axes (cross-product) ⟕ the latest fact
 *  per cell, shown as a status (missing/expired/expiring/valid by an expiry date,
 *  or the latest value of a field). Compiles to a spine query — no view. */
type MatrixSpec = {
  rowSource: string
  rowLabel: string
  /** Optional 2nd row label field, concatenated for a unique display (e.g. last + first). */
  rowLabel2?: string
  colSource: string
  colLabel: string
  colLabel2?: string
  factSource: string
  factRowKey: string
  factColKey: string
  latestBy: string
  valueMode: 'coverage' | 'latest'
  expiryField: string
  latestField: string
  /** Per-axis filters (e.g. active people, non-deleted courses). */
  rowFilters: FilterRow[]
  colFilters: FilterRow[]
  factFilters: FilterRow[]
}
type FilterOp = 'eq' | 'neq' | 'contains' | 'gte' | 'lte' | 'in' | 'is_null' | 'is_not_null'
type FilterRow = { field: string; op: FilterOp; value: string }
type BreakoutRow = { field: string; bin?: BhqlBin; expr?: BhqlExpr; unnest?: 'array' | 'jsonb' }
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
  /** When set, this is a CUSTOM-EXPRESSION measure (a formula that may contain
   *  aggregates, e.g. days-since) — the structured fn/field/ratio are ignored. */
  expr?: BhqlExpr
}

/** A cross-TABLE rate: numerator aggregated on the primary source ÷ denominator
 *  aggregated on ANOTHER source, joined on the shared grain (the breakouts). This
 *  is how TRIR (recordable incidents ÷ hours worked × 200000) is built with no
 *  view. `on[i]` is the field on `denSource` that aligns with primary breakout i;
 *  with no breakouts the two single-row aggregates cross-join (a scalar rate). */
type CrossMetricRow = {
  numFn: BhqlAggFn
  numField?: string
  numWhere?: MeasureWhere
  denSource: string
  denFn: BhqlAggFn
  denField?: string
  denWhere?: MeasureWhere
  /** When set, the denominator is a reusable Metric card (its measure is loaded
   *  + joined at run time) — `denSource/denFn/denField/denWhere` are then ignored. */
  denMetricId?: string
  on: string[]
  multiplier: number
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

const inputCls =
  'h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
// Selects add the `.app-select` treatment (globals.css: appearance-none + custom
// chevron + line-height:normal) so the value text isn't clipped by native macOS
// chrome at the compact h-7/h-8 sizes used throughout the studio. `pr-7` leaves
// room for the chevron.
const selectCls = cn(inputCls, 'app-select pr-7')
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

/** Compile a row of structured filters into a ReportRuleGroup (AND), dropping
 *  incomplete rows. Used by the matrix axes (and mirrors the summarize filter). */
function filtersToGroup(rows: FilterRow[]): ReportRuleGroup | null {
  const rules = rows
    .filter((f) => f.field && (f.op === 'is_null' || f.op === 'is_not_null' || f.value !== ''))
    .map((f) => ({ field: f.field, op: f.op, value: coerceValue(f.value, f.op) }))
  return rules.length ? { combinator: 'and', rules } : null
}

const CURRENT_DATE_EXPR: BhqlExpr = { ex: 'call', fn: 'current_date', args: [] }

/** The standard coverage CASE (missing/valid/expired/expiring) keyed on a fact
 *  expiry field ref — the training-matrix RAG colours come from these strings. */
function coverageCase(expiryRef: string): BhqlExpr {
  return {
    ex: 'case',
    branches: [
      { when: { ex: 'isnull', arg: { ex: 'field', field: 'f.id' } }, then: { ex: 'lit', value: 'missing' } },
      { when: { ex: 'isnull', arg: { ex: 'field', field: expiryRef } }, then: { ex: 'lit', value: 'valid' } },
      { when: { ex: 'compare', op: '<', left: { ex: 'field', field: expiryRef }, right: CURRENT_DATE_EXPR }, then: { ex: 'lit', value: 'expired' } },
      { when: { ex: 'compare', op: '<=', left: { ex: 'field', field: expiryRef }, right: { ex: 'arith', op: '+', left: CURRENT_DATE_EXPR, right: { ex: 'lit', value: 90 } } }, then: { ex: 'lit', value: 'expiring' } },
    ],
    else: { ex: 'lit', value: 'valid' },
  }
}

/** Pick a field by name preference (else the first non-pk) — for matrix defaults. */
function pickField(entity: AnalyticsEntity | undefined, prefer: RegExp): string {
  if (!entity) return ''
  const cols = entity.columns.filter((c) => c.semanticType !== 'pk')
  return (cols.find((c) => prefer.test(c.key)) ?? cols[0])?.key ?? ''
}

function defaultMatrixSpec(
  entities: AnalyticsEntity[],
  entityMap: Record<string, AnalyticsEntity>,
): MatrixSpec {
  const has = (k: string) => Boolean(entityMap[k])
  const rowSource = has('people') ? 'people' : (entities[0]?.key ?? '')
  const colSource = has('training_courses') ? 'training_courses' : (entities[1]?.key ?? rowSource)
  const factSource = has('training_records') ? 'training_records' : (entities[2]?.key ?? rowSource)
  const factEntity = entityMap[factSource]
  const colKeys = (src: string) => new Set((entityMap[src]?.columns ?? []).map((c) => c.key))
  const dimFilters = (src: string, active: boolean): FilterRow[] => {
    const keys = colKeys(src)
    const f: FilterRow[] = []
    if (active && keys.has('status')) f.push({ field: 'status', op: 'eq', value: 'active' })
    if (keys.has('deleted_at')) f.push({ field: 'deleted_at', op: 'is_null', value: '' })
    return f
  }
  const second = (src: string, key: string) => (colKeys(src).has(key) ? key : undefined)
  return {
    rowSource,
    rowLabel: pickField(entityMap[rowSource], /last_name|name|title|label/),
    rowLabel2: second(rowSource, 'first_name'),
    colSource,
    colLabel: pickField(entityMap[colSource], /code|name|title/),
    factSource,
    factRowKey: pickField(factEntity, /person_id|people_id/),
    factColKey: pickField(factEntity, /course_id|item_id|type_id/),
    latestBy: pickField(factEntity, /completed_on|completed|occurred_at|created_at|date/),
    valueMode: 'coverage',
    expiryField: pickField(factEntity, /expires_on|expiry|valid_until/),
    latestField: pickField(factEntity, /completed_on|status|created_at/),
    rowFilters: dimFilters(rowSource, true),
    colFilters: dimFilters(colSource, false),
    factFilters: dimFilters(factSource, false),
  }
}

export type CardStudioInitial = {
  id?: string
  name: string
  query: BhqlQuery | null
  vizType: string
  vizSettings?: Record<string, unknown>
  kind?: string
  config?: InsightCardConfig | null
}

export type StudioMetric = { id: string; name: string; source: string }

export function CardStudio({
  initial,
  entities,
  metrics = [],
}: {
  initial: CardStudioInitial
  entities: AnalyticsEntity[]
  metrics?: StudioMetric[]
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
  // Computed-expression measures/breakouts (e.g. datediff, CASE buckets) are not
  // yet editable in the structured rail — held verbatim so the card round-trips.
  const [extraAggs, setExtraAggs] = useState<BhqlExprMeasure[]>(decoded.extraAggs)
  const [extraBreakouts, setExtraBreakouts] = useState<BhqlBreakout[]>(decoded.extraBreakouts)
  const [crossMetrics, setCrossMetrics] = useState<CrossMetricRow[]>(decoded.crossMetrics)
  const [matrixSpec, setMatrixSpec] = useState<MatrixSpec>(
    () => decoded.matrixSpec ?? defaultMatrixSpec(entities, entityMap),
  )
  const [vizType, setVizType] = useState<string>(initial.vizType || 'table')
  const [vizTouched, setVizTouched] = useState(Boolean(initial.id))
  const [suggestedViz, setSuggestedViz] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  // AI card mode: the rail builds a DATASET; the model analyses it on demand
  // under the instruction below (kind='ai' + config). Distinct from "Ask AI",
  // which only drafts a normal query.
  const initialAiCfg = initial.config?.kind === 'ai' ? initial.config : null
  const [isAiCard, setIsAiCard] = useState(initial.kind === 'ai')
  const [analysisPrompt, setAnalysisPrompt] = useState(initialAiCfg?.prompt ?? '')
  const [analysisOutput, setAnalysisOutput] = useState<AiCardOutputShape>(
    initialAiCfg?.output ?? 'insights',
  )
  // Reusable metric: this card's aggregate can be referenced as a denominator in
  // other cards' cross-table rates (kind='metric'). Mutually exclusive with AI.
  const [isMetric, setIsMetric] = useState(initial.kind === 'metric')

  const entity = entityMap[entityKey]
  const cols = entity?.columns ?? []
  // Source columns + every column reachable through a single-hop FK relation, so
  // group-bys / measures / filters can pick a related field ("Site → Name").
  const fields = useMemo(() => buildFields(entity, entityMap), [entity, entityMap])

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

    if (mode === 'matrix') {
      const ms = matrixSpec
      const statusAgg: BhqlAnyMeasure =
        ms.valueMode === 'coverage'
          ? {
              kind: 'expr',
              alias: 'status',
              expr: { ex: 'agg', fn: 'min', arg: coverageCase(`f.${ms.expiryField}`) },
            }
          : { fn: 'min', field: `f.${ms.latestField}`, alias: 'status' }
      // A label is a single field, or a concat of two (unique display, e.g. last + first).
      const label = (alias: string, dimAlias: string, f1: string, f2?: string): BhqlBreakout =>
        f2
          ? {
              alias,
              expr: {
                ex: 'call',
                fn: 'concat',
                args: [
                  { ex: 'field', field: `${dimAlias}.${f1}` },
                  { ex: 'lit', value: ' · ' },
                  { ex: 'field', field: `${dimAlias}.${f2}` },
                ],
              },
            }
          : { alias, field: `${dimAlias}.${f1}` }
      return {
        version: 'bhql/1',
        display: 'pivot',
        pivot: {
          rows: [{ breakout: 'row' }],
          columns: [{ breakout: 'col' }],
          values: [{ measure: 'status' }],
        },
        stages: [
          {
            source: ms.rowSource as never,
            spine: {
              dimensions: [
                { alias: 'r', source: ms.rowSource, filter: filtersToGroup(ms.rowFilters) },
                { alias: 'c', source: ms.colSource, filter: filtersToGroup(ms.colFilters) },
              ],
              facts: [
                {
                  alias: 'f',
                  source: ms.factSource,
                  filter: filtersToGroup(ms.factFilters),
                  on: [
                    { field: ms.factRowKey, equals: 'r.id' },
                    { field: ms.factColKey, equals: 'c.id' },
                  ],
                  latestBy: ms.latestBy ? [{ ref: ms.latestBy, direction: 'desc' }] : undefined,
                },
              ],
            },
            breakouts: [
              label('row', 'r', ms.rowLabel, ms.rowLabel2),
              label('col', 'c', ms.colLabel, ms.colLabel2),
            ],
            aggregations: [statusAgg],
            orderBy: [
              { ref: 'row', direction: 'asc' },
              { ref: 'col', direction: 'asc' },
            ],
            limit: 50_000,
          },
        ],
      }
    }

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
    // Reserve passthrough (expression) aliases so generated ones don't collide.
    for (const eb of extraBreakouts) used.add(eb.alias)
    for (const ea of extraAggs) used.add(ea.alias)
    const bks: BhqlBreakout[] = []
    for (const b of breakouts) {
      if (b.expr) bks.push({ expr: b.expr, alias: uniq('col') })
      else if (b.field)
        bks.push({
          field: b.field,
          alias: uniq(b.field),
          bin: b.unnest ? undefined : b.bin,
          unnest: b.unnest,
        })
    }
    bks.push(...extraBreakouts)
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
      if (m.expr) {
        // Custom-expression (formula) measure — emitted verbatim as a BhqlExprMeasure.
        const a = uniq('expr')
        mss.push({ kind: 'expr', alias: a, expr: m.expr })
        outputAliases.push(a)
      } else if (m.calc) {
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
    // Passthrough custom-expression measures (verbatim, with their own aliases).
    for (const ea of extraAggs) {
      mss.push(ea)
      outputAliases.push(ea.alias)
    }

    // Cross-table rates: a measure on ANOTHER source joined to the primary grain,
    // divided into a calc. With breakouts each maps to a field on the other source;
    // with none, the two single-row aggregates cross-join (a scalar rate).
    const joinedSources: BhqlJoinedSource[] = []
    const metricRefs: BhqlMetricRef[] = []
    crossMetrics.forEach((cm, i) => {
      const numAlias = `cm${i}_num`
      const denAlias = `cm${i}_den`
      const rateAlias = `cm${i}_rate`
      mss.push({
        fn: cm.numFn,
        field: cm.numFn === 'count' ? undefined : cm.numField,
        alias: numAlias,
        filter: whereToGroup(cm.numWhere),
      })
      const on = bks.map((b, j) => ({ breakout: b.alias, field: cm.on[j] ?? '', bin: b.bin }))
      if (cm.denMetricId) {
        // Reusable metric — resolved + joined at run time (live propagation).
        metricRefs.push({ metricId: cm.denMetricId, alias: denAlias, on })
      } else {
        joinedSources.push({
          source: cm.denSource,
          measures: [
            {
              fn: cm.denFn,
              field: cm.denFn === 'count' ? undefined : cm.denField,
              alias: denAlias,
              filter: whereToGroup(cm.denWhere),
            },
          ],
          on,
        })
      }
      mss.push({
        kind: 'calc',
        alias: rateAlias,
        numerator: numAlias,
        denominator: denAlias,
        multiplier: cm.multiplier,
      })
      outputAliases.push(rateAlias)
    })

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
        {
          source: entityKey as never,
          filter,
          breakouts: bks,
          aggregations: mss,
          joinedSources: joinedSources.length ? joinedSources : undefined,
          metricRefs: metricRefs.length ? metricRefs : undefined,
          limit: 2000,
        },
      ],
    }
  }, [
    entityKey,
    mode,
    columns,
    breakouts,
    measures,
    filters,
    pivotOn,
    cols,
    extraAggs,
    extraBreakouts,
    crossMetrics,
    matrixSpec,
  ])

  // Viz settings for BOTH the live preview and the saved card. A scalar/progress
  // card's value is pinned to the primary output column — the calc (ratio) is
  // emitted last, and buildAst regenerates aliases on every render, so a stored
  // alias would go stale and the scalar would fall back to the raw numerator.
  const vizSettings = useMemo<Record<string, unknown>>(() => {
    const s: Record<string, unknown> = { ...(initial.vizSettings ?? {}) }
    const primaryAlias = ast.stages[0]?.aggregations?.at(-1)?.alias
    if ((vizType === 'scalar' || vizType === 'progress') && primaryAlias) {
      s.valueField = primaryAlias
    }
    return s
  }, [ast, vizType, initial.vizSettings])

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
      setExtraAggs(d.extraAggs)
      setExtraBreakouts(d.extraBreakouts)
      setCrossMetrics(d.crossMetrics)
      if (d.matrixSpec) setMatrixSpec(d.matrixSpec)
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
    const payload = {
      name,
      query: ast,
      vizType: isAiCard ? 'table' : mode === 'matrix' ? 'pivot' : vizType,
      vizSettings,
      kind: (isMetric ? 'metric' : isAiCard ? 'ai' : 'question') as 'ai' | 'question' | 'metric',
      config: isAiCard
        ? ({ kind: 'ai', prompt: analysisPrompt, output: analysisOutput } as const)
        : null,
    }
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
              {(['rows', 'summarize', 'matrix'] as Mode[]).map((m) => (
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
                  {m === 'rows' ? 'Raw rows' : m === 'summarize' ? 'Summarize' : 'Matrix'}
                </button>
              ))}
            </div>
          </div>

          {/* Card type — AI analysis / reusable metric (not for a matrix). */}
          {mode !== 'matrix' ? (
          <div className={sectionCls}>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={isAiCard}
                onChange={(e) => {
                  setIsAiCard(e.target.checked)
                  if (e.target.checked) setIsMetric(false)
                }}
              />
              <Sparkles size={13} className="text-teal-500" />
              AI analysis card
            </label>
            <label className="mt-2 flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={isMetric}
                onChange={(e) => {
                  setIsMetric(e.target.checked)
                  if (e.target.checked) setIsAiCard(false)
                }}
              />
              <span className="font-semibold text-violet-500">ƒ</span>
              Reusable metric — referenceable in other cards
            </label>
            {isAiCard ? (
              <div className="mt-2 space-y-2">
                <textarea
                  value={analysisPrompt}
                  onChange={(e) => setAnalysisPrompt(e.target.value)}
                  rows={3}
                  placeholder="What should the AI do with this data? e.g. “Summarise the top risks and who should act.”"
                  className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-xs outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <select
                  value={analysisOutput}
                  onChange={(e) => setAnalysisOutput(e.target.value as AiCardOutputShape)}
                  className={cn(selectCls, 'h-8 text-xs')}
                >
                  <option value="insights">Findings &amp; insights</option>
                  <option value="summary">Short summary</option>
                  <option value="bullets">Key bullet points</option>
                </select>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  The rail below builds the dataset the model reads. Open the saved card to run it.
                </p>
              </div>
            ) : null}
          </div>
          ) : null}

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
          ) : mode === 'matrix' ? (
            <MatrixEditor
              spec={matrixSpec}
              onChange={setMatrixSpec}
              entities={entities}
              entityMap={entityMap}
            />
          ) : (
            <>
              <RailList
                title="Group by"
                items={breakouts}
                onAdd={() => setBreakouts((b) => [...b, { field: cols[0]?.key ?? '' }])}
                onRemove={(i) => setBreakouts((b) => b.filter((_, j) => j !== i))}
                render={(b, i) => (
                  <BreakoutEditor
                    fields={fields}
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
                    fields={fields}
                    row={m}
                    onChange={(next) => setMeasures((ms) => ms.map((x, j) => (j === i ? next : x)))}
                  />
                )}
              />
              <RailList
                title="Cross-table rates"
                items={crossMetrics}
                onAdd={() =>
                  setCrossMetrics((c) => [
                    ...c,
                    {
                      numFn: 'count',
                      denSource: entities[0]?.key ?? '',
                      denFn: 'count',
                      on: [],
                      multiplier: 1,
                    },
                  ])
                }
                onRemove={(i) => setCrossMetrics((c) => c.filter((_, j) => j !== i))}
                render={(cm, i) => (
                  <CrossMetricEditor
                    row={cm}
                    primaryFields={fields}
                    breakouts={breakouts}
                    entities={entities}
                    entityMap={entityMap}
                    metrics={metrics}
                    onChange={(next) =>
                      setCrossMetrics((cs) => cs.map((x, j) => (j === i ? next : x)))
                    }
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
                    {fieldCol(fields, breakouts[0]?.field ?? '')?.label ?? '1st group'}, columns ={' '}
                    {fieldCol(fields, breakouts[1]?.field ?? '')?.label ?? '2nd group'}
                  </label>
                </div>
              ) : null}
            </>
          )}

          {/* Filters (the matrix has its own structure). */}
          {mode !== 'matrix' ? (
          <RailList
            title="Filters"
            items={filters}
            onAdd={() =>
              setFilters((f) => [...f, { field: cols[0]?.key ?? '', op: 'eq', value: '' }])
            }
            onRemove={(i) => setFilters((f) => f.filter((_, j) => j !== i))}
            render={(f, i) => (
              <FilterEditor
                fields={fields}
                row={f}
                onChange={(next) => setFilters((fs) => fs.map((x, j) => (j === i ? next : x)))}
              />
            )}
          />
          ) : null}

          {/* Visualize — AI cards + matrices render their own output, not a chart. */}
          {!isAiCard && mode !== 'matrix' ? (
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
          ) : null}
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
                <VizRenderer
                  vizType={isAiCard ? 'table' : mode === 'matrix' ? 'pivot' : vizType}
                  result={result}
                  settings={vizSettings}
                  label={name}
                />
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

/** A pickable field: a column on the source entity, or one reached by following
 *  a foreign-key relation (value = "<via>.<column>", grouped under the relation). */
type FieldChoice = { value: string; label: string; group: string | null; col: AnalyticsColumn }

/** Source-entity columns + every column reachable via a single-hop FK relation.
 *  This is what makes cross-table cards self-serve: "Journals → Site → Name" with
 *  no view. Relations only ever target RLS-safe entities (enforced at discovery). */
function buildFields(
  entity: AnalyticsEntity | undefined,
  entityMap: Record<string, AnalyticsEntity>,
): FieldChoice[] {
  if (!entity) return []
  const out: FieldChoice[] = entity.columns.map((c) => ({
    value: c.key,
    label: c.label,
    group: null,
    col: c,
  }))
  for (const rel of entity.relations ?? []) {
    const target = entityMap[rel.target]
    if (!target) continue
    for (const c of target.columns) {
      if (c.semanticType === 'pk') continue // the id itself isn't a useful related field
      out.push({ value: `${rel.via}.${c.key}`, label: c.label, group: rel.label, col: c })
    }
    // Second hop: only "label-ish" columns (names/codes/categories) of the next
    // entity, so a 2-hop path ("Site → Parent → Name") is reachable without the
    // dropdown exploding to every column of every neighbour.
    for (const rel2 of target.relations ?? []) {
      const target2 = entityMap[rel2.target]
      if (!target2 || target2.key === entity.key) continue
      for (const c of target2.columns) {
        const labelish =
          c.semanticType === 'entity-name' ||
          c.semanticType === 'category' ||
          /^(name|code|title|label|status|type)$/.test(c.key)
        if (!labelish) continue
        out.push({
          value: `${rel.via}.${rel2.via}.${c.key}`,
          label: c.label,
          group: `${rel.label} → ${rel2.label}`,
          col: c,
        })
      }
    }
  }
  return out
}

const fieldCol = (fields: FieldChoice[], value: string): AnalyticsColumn | undefined =>
  fields.find((f) => f.value === value)?.col

/** <option>/<optgroup> list for a field <select>: local columns first, then one
 *  optgroup per relation. `predicate` filters by column (e.g. numeric-only). */
function FieldOptions({
  fields,
  predicate,
  placeholder,
}: {
  fields: FieldChoice[]
  predicate?: (c: AnalyticsColumn) => boolean
  placeholder?: string
}) {
  const filtered = predicate ? fields.filter((f) => predicate(f.col)) : fields
  const groups = new Map<string, FieldChoice[]>()
  for (const f of filtered) {
    if (f.group == null) continue
    const arr = groups.get(f.group) ?? []
    arr.push(f)
    groups.set(f.group, arr)
  }
  return (
    <>
      {placeholder ? <option value="">{placeholder}</option> : null}
      {filtered
        .filter((f) => f.group == null)
        .map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      {[...groups.entries()].map(([g, opts]) => (
        <optgroup key={g} label={`→ ${g}`}>
          {opts.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  )
}

function BreakoutEditor({
  fields,
  row,
  onChange,
}: {
  fields: FieldChoice[]
  row: BreakoutRow
  onChange: (next: BreakoutRow) => void
}) {
  const labelForField = (key: string) => {
    const f = fields.find((x) => x.value === key)
    return f ? exprLabel(f) : key
  }
  const resolveColumn = (label: string) => {
    const lc = label.trim().toLowerCase()
    return (
      fields.find((x) => x.label.toLowerCase() === lc || exprLabel(x).toLowerCase() === lc)
        ?.value ?? null
    )
  }
  const [exprText, setExprText] = useState(() =>
    row.expr ? serializeExpression(row.expr, { labelForField }) : '',
  )

  // Computed-column (formula) group-by — e.g. a CASE age bucket.
  if (row.expr !== undefined) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold tracking-wide text-violet-500 uppercase">
            ƒx Custom column
          </span>
          <button
            type="button"
            onClick={() => onChange({ field: fields[0]?.value ?? '' })}
            className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            ← simple field
          </button>
        </div>
        <ExpressionField
          value={exprText}
          fields={fields}
          placeholder='case([Age] < 7, "0-6 days", "older")'
          onChange={(t) => {
            setExprText(t)
            const r = parseExpression(t, { resolveColumn })
            if (r.ok) onChange({ ...row, expr: r.expr })
          }}
        />
      </div>
    )
  }

  const col = fieldCol(fields, row.field)
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() =>
          onChange({ field: '', expr: { ex: 'field', field: fields[0]?.value ?? '' } })
        }
        className="text-[11px] font-medium text-violet-600 hover:text-violet-700 dark:text-violet-400"
      >
        ƒx Custom column
      </button>
      <select
        value={row.field}
        onChange={(e) => onChange({ ...row, field: e.target.value, bin: undefined })}
        className={selectCls}
      >
        <FieldOptions fields={fields} />
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
      {col?.canBinNumeric ? (
        <select
          value={row.bin?.kind === 'numeric' ? String(row.bin.numBins) : ''}
          onChange={(e) =>
            onChange({
              ...row,
              bin: e.target.value
                ? { kind: 'numeric', numBins: Number(e.target.value) }
                : undefined,
            })
          }
          className={cn(selectCls, 'h-8 text-xs')}
        >
          <option value="">No buckets</option>
          {[5, 10, 20, 50].map((n) => (
            <option key={n} value={n}>
              {n} buckets
            </option>
          ))}
        </select>
      ) : null}
      {col?.arrayUnnest ? (
        <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400">
          <input
            type="checkbox"
            checked={!!row.unnest}
            onChange={(e) =>
              onChange({
                ...row,
                unnest: e.target.checked ? col?.arrayUnnest : undefined,
                bin: undefined,
              })
            }
          />
          Unnest — one row per item
        </label>
      ) : null}
    </div>
  )
}

function ConditionRow({
  fields,
  where,
  onChange,
}: {
  fields: FieldChoice[]
  where?: MeasureWhere
  onChange: (w: MeasureWhere | undefined) => void
}) {
  if (!where) {
    return (
      <button
        type="button"
        onClick={() => onChange({ field: fields[0]?.value ?? '', op: 'eq', value: '' })}
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
        <FieldOptions fields={fields} />
      </select>
      <select
        value={where.op}
        onChange={(e) => onChange({ ...where, op: e.target.value as FilterOp })}
        className={cn(selectCls, 'h-7 text-xs')}
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
          placeholder="value to match…"
          className={cn(inputCls, 'h-7 text-xs')}
        />
      ) : null}
    </div>
  )
}

// Rate/scale multiplier — a FREE numeric basis (percent, OSHA per-200k, per-100k,
// per-million, anything) rather than a fixed shortlist, with one-tap presets for
// the common bases. The numerator ÷ denominator is multiplied by this value.
const MULTIPLIER_PRESETS: { label: string; v: number }[] = [
  { label: 'Ratio', v: 1 },
  { label: 'Percent', v: 100 },
  { label: 'Per 100k', v: 100_000 },
  { label: 'Per 200k', v: 200_000 },
]
function MultiplierField({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
          × scale
        </span>
        <input
          type="number"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? 1 : Number(e.target.value))}
          placeholder="1"
          className={cn(inputCls, 'h-8 text-xs')}
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {MULTIPLIER_PRESETS.map((p) => (
          <button
            key={p.v}
            type="button"
            onClick={() => onChange(p.v)}
            className={cn(
              'rounded border px-1.5 py-0.5 text-[10px] transition',
              value === p.v
                ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300'
                : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function MeasureEditor({
  fields,
  row,
  onChange,
}: {
  fields: FieldChoice[]
  row: MeasureRow
  onChange: (next: MeasureRow) => void
}) {
  const labelForField = (key: string) => {
    const f = fields.find((x) => x.value === key)
    return f ? exprLabel(f) : key
  }
  const resolveColumn = (label: string) => {
    const lc = label.trim().toLowerCase()
    return (
      fields.find((x) => x.label.toLowerCase() === lc || exprLabel(x).toLowerCase() === lc)
        ?.value ?? null
    )
  }
  const [exprText, setExprText] = useState(() =>
    row.expr ? serializeExpression(row.expr, { labelForField }) : '',
  )

  // Custom-expression (formula) measure — a Metabase-style "custom aggregation".
  if (row.expr !== undefined) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold tracking-wide text-violet-500 uppercase">
            ƒx Custom aggregation
          </span>
          <button
            type="button"
            onClick={() => onChange({ fn: 'count' })}
            className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            ← simple measure
          </button>
        </div>
        <ExpressionField
          value={exprText}
          fields={fields}
          onChange={(t) => {
            setExprText(t)
            const r = parseExpression(t, { resolveColumn })
            if (r.ok) onChange({ ...row, expr: r.expr })
          }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => onChange({ ...row, calc: false, expr: { ex: 'agg', fn: 'count' } })}
        className="text-[11px] font-medium text-violet-600 hover:text-violet-700 dark:text-violet-400"
      >
        ƒx Custom expression
      </button>
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
          <FieldOptions
            fields={fields}
            placeholder="Pick a field…"
            predicate={(c) => (row.fn === 'sum' || row.fn === 'avg' ? c.canMeasure : true)}
          />
        </select>
      ) : null}
      <ConditionRow
        fields={fields}
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
              <FieldOptions
                fields={fields}
                placeholder="Pick a field…"
                predicate={(c) =>
                  row.denFn === 'sum' || row.denFn === 'avg' ? c.canMeasure : true
                }
              />
            </select>
          ) : null}
          <ConditionRow
            fields={fields}
            where={row.denWhere}
            onChange={(w) => onChange({ ...row, denWhere: w })}
          />
          <MultiplierField
            value={row.multiplier ?? 1}
            onChange={(n) => onChange({ ...row, multiplier: n })}
          />
        </div>
      ) : null}
    </div>
  )
}

function CrossMetricEditor({
  row,
  onChange,
  primaryFields,
  breakouts,
  entities,
  entityMap,
  metrics,
}: {
  row: CrossMetricRow
  onChange: (next: CrossMetricRow) => void
  primaryFields: FieldChoice[]
  breakouts: BreakoutRow[]
  entities: AnalyticsEntity[]
  entityMap: Record<string, AnalyticsEntity>
  metrics: StudioMetric[]
}) {
  // When the denominator is a saved metric, grain-map against the metric's source.
  const metricSource = row.denMetricId
    ? metrics.find((m) => m.id === row.denMetricId)?.source
    : undefined
  const denEntity = entityMap[metricSource ?? row.denSource]
  const denFields = useMemo(() => buildFields(denEntity, entityMap), [denEntity, entityMap])
  const entityGroups = useMemo(() => {
    const m = new Map<string, AnalyticsEntity[]>()
    for (const e of entities) {
      const arr = m.get(e.category) ?? []
      arr.push(e)
      m.set(e.category, arr)
    }
    return [...m.entries()]
  }, [entities])
  const hasFieldBreakouts = breakouts.some((b) => b.field && !b.expr)

  return (
    <div className="space-y-1.5 rounded-md border border-slate-200 p-2 dark:border-slate-700">
      <div className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
        Numerator · this table
      </div>
      <select
        value={row.numFn}
        onChange={(e) => onChange({ ...row, numFn: e.target.value as BhqlAggFn })}
        className={cn(selectCls, 'h-8 text-xs')}
      >
        {AGG_FNS.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </select>
      {row.numFn !== 'count' ? (
        <select
          value={row.numField ?? ''}
          onChange={(e) => onChange({ ...row, numField: e.target.value })}
          className={cn(selectCls, 'h-8 text-xs')}
        >
          <FieldOptions
            fields={primaryFields}
            placeholder="Pick a field…"
            predicate={(c) => (row.numFn === 'sum' || row.numFn === 'avg' ? c.canMeasure : true)}
          />
        </select>
      ) : null}
      <ConditionRow
        fields={primaryFields}
        where={row.numWhere}
        onChange={(w) => onChange({ ...row, numWhere: w })}
      />

      <div className="pt-1 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
        ÷ Denominator
      </div>
      {metrics.length > 0 ? (
        <select
          value={row.denMetricId ?? '__inline'}
          onChange={(e) => {
            const v = e.target.value
            onChange({ ...row, denMetricId: v === '__inline' ? undefined : v, on: [] })
          }}
          className={cn(selectCls, 'h-8 text-xs')}
        >
          <option value="__inline">Build inline (another table)…</option>
          {metrics.map((m) => (
            <option key={m.id} value={m.id}>
              ƒ {m.name} (saved metric)
            </option>
          ))}
        </select>
      ) : null}
      {!row.denMetricId ? (
        <>
          <select
            value={row.denSource}
            onChange={(e) =>
              onChange({ ...row, denSource: e.target.value, denField: undefined, on: [] })
            }
            className={cn(selectCls, 'h-8 text-xs')}
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
          <select
            value={row.denFn}
            onChange={(e) => onChange({ ...row, denFn: e.target.value as BhqlAggFn })}
            className={cn(selectCls, 'h-8 text-xs')}
          >
            {AGG_FNS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          {row.denFn !== 'count' ? (
            <select
              value={row.denField ?? ''}
              onChange={(e) => onChange({ ...row, denField: e.target.value })}
              className={cn(selectCls, 'h-8 text-xs')}
            >
              <FieldOptions
                fields={denFields}
                placeholder="Pick a field…"
                predicate={(c) => (row.denFn === 'sum' || row.denFn === 'avg' ? c.canMeasure : true)}
              />
            </select>
          ) : null}
          <ConditionRow
            fields={denFields}
            where={row.denWhere}
            onChange={(w) => onChange({ ...row, denWhere: w })}
          />
        </>
      ) : null}

      {hasFieldBreakouts ? (
        <div className="space-y-1 rounded bg-slate-50 p-1.5 dark:bg-slate-800/40">
          <div className="text-[10px] tracking-wide text-slate-400 uppercase">Align the grain</div>
          {breakouts.map((b, i) =>
            b.field && !b.expr ? (
              <div key={i} className="flex items-center gap-1">
                <span className="w-1/3 truncate text-[11px] text-slate-500 dark:text-slate-400">
                  {fieldCol(primaryFields, b.field)?.label ?? b.field}
                </span>
                <span className="text-slate-300">↔</span>
                <select
                  value={row.on[i] ?? ''}
                  onChange={(e) => {
                    const on = [...row.on]
                    on[i] = e.target.value
                    onChange({ ...row, on })
                  }}
                  className={cn(selectCls, 'h-7 flex-1 text-xs')}
                >
                  <FieldOptions fields={denFields} placeholder="match field…" />
                </select>
              </div>
            ) : null,
          )}
        </div>
      ) : null}

      <MultiplierField
        value={row.multiplier}
        onChange={(n) => onChange({ ...row, multiplier: n })}
      />
    </div>
  )
}

function MatrixEditor({
  spec,
  onChange,
  entities,
  entityMap,
}: {
  spec: MatrixSpec
  onChange: (next: MatrixSpec) => void
  entities: AnalyticsEntity[]
  entityMap: Record<string, AnalyticsEntity>
}) {
  const entityGroups = useMemo(() => {
    const m = new Map<string, AnalyticsEntity[]>()
    for (const e of entities) {
      const arr = m.get(e.category) ?? []
      arr.push(e)
      m.set(e.category, arr)
    }
    return [...m.entries()]
  }, [entities])
  const entityOptions = () =>
    entityGroups.map(([cat, ents]) => (
      <optgroup key={cat} label={cat}>
        {ents.map((en) => (
          <option key={en.key} value={en.key}>
            {en.label}
          </option>
        ))}
      </optgroup>
    ))
  const fieldOptions = (source: string, predicate?: (c: AnalyticsColumn) => boolean) => {
    const cols = (entityMap[source]?.columns ?? []).filter((c) =>
      predicate ? predicate(c) : c.semanticType !== 'pk',
    )
    return [
      <option key="__" value="">
        Pick a field…
      </option>,
      ...cols.map((c) => (
        <option key={c.key} value={c.key}>
          {c.label}
        </option>
      )),
    ]
  }
  const sel = cn(selectCls, 'h-8 text-xs')
  const lbl = 'text-[10px] font-semibold tracking-wide text-slate-400 uppercase'
  const inline = 'flex items-center gap-1'
  const hint = 'w-1/3 shrink-0 text-[11px] text-slate-500 dark:text-slate-400'

  const rowFields = useMemo(
    () => buildFields(entityMap[spec.rowSource], entityMap),
    [spec.rowSource, entityMap],
  )
  const colFields = useMemo(
    () => buildFields(entityMap[spec.colSource], entityMap),
    [spec.colSource, entityMap],
  )
  const factFields = useMemo(
    () => buildFields(entityMap[spec.factSource], entityMap),
    [spec.factSource, entityMap],
  )
  const secondLabelOptions = (source: string) =>
    (entityMap[source]?.columns ?? [])
      .filter((c) => c.semanticType !== 'pk')
      .map((c) => (
        <option key={c.key} value={c.key}>
          {c.label}
        </option>
      ))
  const filterList = (rows: FilterRow[], fields: FieldChoice[], onRows: (r: FilterRow[]) => void) => (
    <div className="space-y-1 rounded bg-slate-50 p-1.5 dark:bg-slate-800/40">
      <div className="flex items-center justify-between">
        <span className="text-[10px] tracking-wide text-slate-400 uppercase">Filters</span>
        <button
          type="button"
          onClick={() => onRows([...rows, { field: fields[0]?.value ?? '', op: 'eq', value: '' }])}
          className="text-teal-600 hover:text-teal-700"
        >
          <Plus size={12} />
        </button>
      </div>
      {rows.length === 0 ? <p className="text-[10px] text-slate-400">All rows.</p> : null}
      {rows.map((f, i) => (
        <div key={i} className="flex items-start gap-1">
          <div className="flex-1">
            <FilterEditor
              fields={fields}
              row={f}
              onChange={(next) => onRows(rows.map((x, j) => (j === i ? next : x)))}
            />
          </div>
          <button
            type="button"
            onClick={() => onRows(rows.filter((_, j) => j !== i))}
            className="mt-1 text-slate-300 hover:text-rose-500"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </div>
  )

  return (
    <div className={cn(sectionCls, 'space-y-3')}>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Every <b>row</b> × every <b>column</b>, coloured by the latest matching record — no view.
      </p>
      <div className="space-y-1">
        <div className={lbl}>Rows</div>
        <select
          value={spec.rowSource}
          onChange={(e) => onChange({ ...spec, rowSource: e.target.value, rowLabel: '' })}
          className={sel}
        >
          {entityOptions()}
        </select>
        <select
          value={spec.rowLabel}
          onChange={(e) => onChange({ ...spec, rowLabel: e.target.value })}
          className={sel}
        >
          {fieldOptions(spec.rowSource)}
        </select>
        <select
          value={spec.rowLabel2 ?? ''}
          onChange={(e) => onChange({ ...spec, rowLabel2: e.target.value || undefined })}
          className={cn(sel, 'text-slate-500')}
        >
          <option value="">+ second label (optional)</option>
          {secondLabelOptions(spec.rowSource)}
        </select>
        {filterList(spec.rowFilters, rowFields, (r) => onChange({ ...spec, rowFilters: r }))}
      </div>
      <div className="space-y-1">
        <div className={lbl}>Columns</div>
        <select
          value={spec.colSource}
          onChange={(e) => onChange({ ...spec, colSource: e.target.value, colLabel: '' })}
          className={sel}
        >
          {entityOptions()}
        </select>
        <select
          value={spec.colLabel}
          onChange={(e) => onChange({ ...spec, colLabel: e.target.value })}
          className={sel}
        >
          {fieldOptions(spec.colSource)}
        </select>
        <select
          value={spec.colLabel2 ?? ''}
          onChange={(e) => onChange({ ...spec, colLabel2: e.target.value || undefined })}
          className={cn(sel, 'text-slate-500')}
        >
          <option value="">+ second label (optional)</option>
          {secondLabelOptions(spec.colSource)}
        </select>
        {filterList(spec.colFilters, colFields, (r) => onChange({ ...spec, colFilters: r }))}
      </div>
      <div className="space-y-1">
        <div className={lbl}>Latest record from</div>
        <select
          value={spec.factSource}
          onChange={(e) =>
            onChange({
              ...spec,
              factSource: e.target.value,
              factRowKey: '',
              factColKey: '',
              latestBy: '',
              expiryField: '',
              latestField: '',
            })
          }
          className={sel}
        >
          {entityOptions()}
        </select>
        <div className={inline}>
          <span className={hint}>→ row by</span>
          <select
            value={spec.factRowKey}
            onChange={(e) => onChange({ ...spec, factRowKey: e.target.value })}
            className={cn(sel, 'flex-1')}
          >
            {fieldOptions(spec.factSource)}
          </select>
        </div>
        <div className={inline}>
          <span className={hint}>→ col by</span>
          <select
            value={spec.factColKey}
            onChange={(e) => onChange({ ...spec, factColKey: e.target.value })}
            className={cn(sel, 'flex-1')}
          >
            {fieldOptions(spec.factSource)}
          </select>
        </div>
        <div className={inline}>
          <span className={hint}>latest by</span>
          <select
            value={spec.latestBy}
            onChange={(e) => onChange({ ...spec, latestBy: e.target.value })}
            className={cn(sel, 'flex-1')}
          >
            {fieldOptions(spec.factSource)}
          </select>
        </div>
        {filterList(spec.factFilters, factFields, (r) => onChange({ ...spec, factFilters: r }))}
      </div>
      <div className="space-y-1">
        <div className={lbl}>Cell value</div>
        <select
          value={spec.valueMode}
          onChange={(e) =>
            onChange({ ...spec, valueMode: e.target.value as 'coverage' | 'latest' })
          }
          className={sel}
        >
          <option value="coverage">Coverage status (by expiry)</option>
          <option value="latest">Latest value of a field</option>
        </select>
        {spec.valueMode === 'coverage' ? (
          <div className={inline}>
            <span className={hint}>expiry date</span>
            <select
              value={spec.expiryField}
              onChange={(e) => onChange({ ...spec, expiryField: e.target.value })}
              className={cn(sel, 'flex-1')}
            >
              {fieldOptions(spec.factSource, (c) => c.kind === 'date' || c.kind === 'timestamp')}
            </select>
          </div>
        ) : (
          <div className={inline}>
            <span className={hint}>show field</span>
            <select
              value={spec.latestField}
              onChange={(e) => onChange({ ...spec, latestField: e.target.value })}
              className={cn(sel, 'flex-1')}
            >
              {fieldOptions(spec.factSource)}
            </select>
          </div>
        )}
      </div>
    </div>
  )
}

function FilterEditor({
  fields,
  row,
  onChange,
}: {
  fields: FieldChoice[]
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
        <FieldOptions fields={fields} />
      </select>
      <select
        value={row.op}
        onChange={(e) => onChange({ ...row, op: e.target.value as FilterOp })}
        className={cn(selectCls, 'h-8 text-xs')}
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
          placeholder="value to match…"
          className={cn(inputCls, 'h-8 text-xs')}
        />
      ) : null}
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
  /** Computed-expression measures/breakouts carried through edits verbatim
   *  (no structured editor yet), so an expression card round-trips losslessly. */
  extraAggs: BhqlExprMeasure[]
  extraBreakouts: BhqlBreakout[]
  /** Cross-table rates (numerator ÷ a measure on another source). */
  crossMetrics: CrossMetricRow[]
  /** A coverage matrix (spine query) → the guided matrix editor. */
  matrixSpec?: MatrixSpec
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
      extraAggs: [],
      extraBreakouts: [],
      crossMetrics: [],
    }
  }

  // A spine query → the guided coverage-matrix editor.
  if (stage.spine) {
    const sp = stage.spine
    const fact = sp.facts?.[0]
    const stripAlias = (ref?: string) => (ref ? ref.split('.').slice(1).join('.') : '')
    const groupToRows = (g?: ReportRuleGroup | null): FilterRow[] =>
      (g?.rules ?? []).flatMap((r) => {
        if (!r || typeof r !== 'object' || !('field' in r)) return []
        const rr = r as { field: string; op: string; value?: unknown }
        return [
          {
            field: rr.field,
            op: rr.op as FilterOp,
            value: Array.isArray(rr.value)
              ? rr.value.join(', ')
              : rr.value == null
                ? ''
                : String(rr.value),
          },
        ]
      })
    // A label breakout is a single field, or a concat of two (composed display).
    const labelFields = (b?: BhqlBreakout): { f1: string; f2?: string } => {
      if (!b) return { f1: '' }
      if (b.field) return { f1: stripAlias(b.field) }
      const ex = b.expr as { ex?: string; fn?: string; args?: { ex?: string; field?: string }[] }
      if (ex?.ex === 'call' && ex.fn === 'concat') {
        const fields = (ex.args ?? []).filter((a) => a.ex === 'field').map((a) => stripAlias(a.field))
        return { f1: fields[0] ?? '', f2: fields[1] }
      }
      return { f1: '' }
    }
    const agg = stage.aggregations?.[0]
    let valueMode: 'coverage' | 'latest' = 'latest'
    let expiryField = ''
    let latestField = ''
    if (agg && (agg as { kind?: string }).kind === 'expr') {
      valueMode = 'coverage'
      const expr = (agg as BhqlExprMeasure).expr as {
        arg?: { branches?: { when?: { arg?: { field?: string } } }[] }
      }
      expiryField = stripAlias(expr.arg?.branches?.[1]?.when?.arg?.field)
    } else if (agg && (agg as { kind?: string }).kind === undefined) {
      latestField = stripAlias((agg as BhqlMeasure).field)
    }
    const rowL = labelFields(stage.breakouts?.[0])
    const colL = labelFields(stage.breakouts?.[1])
    const matrixSpec: MatrixSpec = {
      rowSource: sp.dimensions[0]?.source ?? '',
      rowLabel: rowL.f1,
      rowLabel2: rowL.f2,
      colSource: sp.dimensions[1]?.source ?? '',
      colLabel: colL.f1,
      colLabel2: colL.f2,
      factSource: fact?.source ?? '',
      factRowKey: fact?.on?.[0]?.field ?? '',
      factColKey: fact?.on?.[1]?.field ?? '',
      latestBy: fact?.latestBy?.[0]?.ref ?? '',
      valueMode,
      expiryField,
      latestField,
      rowFilters: groupToRows(sp.dimensions[0]?.filter),
      colFilters: groupToRows(sp.dimensions[1]?.filter),
      factFilters: groupToRows(fact?.filter),
    }
    return {
      entityKey: stage.source,
      mode: 'matrix',
      columns: [],
      breakouts: [],
      measures: [],
      filters: [],
      pivotOn: true,
      extraAggs: [],
      extraBreakouts: [],
      crossMetrics: [],
      matrixSpec,
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
  // Field breakouts → a structured row; computed-expression breakouts → an
  // editable formula row (field left blank, expr carried for the editor).
  const breakouts: BreakoutRow[] = (stage.breakouts ?? []).map((b) =>
    b.expr ? { field: '', expr: b.expr } : { field: b.field ?? '', bin: b.bin, unnest: b.unnest },
  )
  const extraBreakouts: BhqlBreakout[] = []

  // Reconstruct measures. A calc (ratio) measure is re-hydrated into ONE row —
  // fn/field/where from its numerator base, denFn/denField/denWhere from its
  // denominator base, plus the multiplier — and the consumed base measures are
  // dropped, so an edited ratio card round-trips through buildAst() instead of
  // silently decomposing into two plain measures with the ratio lost. Custom
  // (expr) measures are carried through verbatim (no structured editor yet).
  const aggs = stage.aggregations ?? []
  // Custom-expression measures decode into editable rows (below), not passthrough.
  const extraAggs: BhqlExprMeasure[] = []
  const baseByAlias = new Map<string, BhqlMeasure>()
  const consumed = new Set<string>()
  for (const m of aggs) {
    if (m.kind === 'calc') {
      consumed.add(m.numerator)
      if (m.denominator) consumed.add(m.denominator)
    } else if (m.kind !== 'expr') {
      baseByAlias.set(m.alias, m)
    }
  }
  // Cross-table rates: each joined source + the calc that divides by its measure
  // reconstructs into one CrossMetricRow; its consumed aliases are skipped below
  // so the numerator/rate don't also show as plain measures.
  const joinedSources = stage.joinedSources ?? []
  const crossMetrics: CrossMetricRow[] = []
  const crossConsumed = new Set<string>()
  const breakoutAliasToIndex = new Map(
    (stage.breakouts ?? []).map((b, i) => [b.alias, i] as const),
  )
  for (const js of joinedSources) {
    const den = js.measures[0]
    if (!den) continue
    const calc = aggs.find((m) => m.kind === 'calc' && m.denominator === den.alias) as
      | { numerator: string; multiplier?: number; alias: string }
      | undefined
    if (!calc) continue
    const num = aggs.find(
      (m) => (m.kind === undefined || m.kind === 'agg') && m.alias === calc.numerator,
    ) as BhqlMeasure | undefined
    if (!num) continue
    crossConsumed.add(num.alias)
    crossConsumed.add(calc.alias)
    const on: string[] = new Array(breakoutAliasToIndex.size).fill('')
    for (const k of js.on) {
      const idx = breakoutAliasToIndex.get(k.breakout)
      if (idx != null) on[idx] = k.field
    }
    crossMetrics.push({
      numFn: num.fn,
      numField: num.field,
      numWhere: groupToWhere(num.filter),
      denSource: js.source,
      denFn: den.fn,
      denField: den.field,
      denWhere: groupToWhere(den.filter),
      on,
      multiplier: calc.multiplier ?? 1,
    })
  }
  // Reusable-metric-backed rates reconstruct the same way (denominator = a metric).
  for (const mr of stage.metricRefs ?? []) {
    const calc = aggs.find((m) => m.kind === 'calc' && m.denominator === mr.alias) as
      | { numerator: string; multiplier?: number; alias: string }
      | undefined
    if (!calc) continue
    const num = aggs.find(
      (m) => (m.kind === undefined || m.kind === 'agg') && m.alias === calc.numerator,
    ) as BhqlMeasure | undefined
    if (!num) continue
    crossConsumed.add(num.alias)
    crossConsumed.add(calc.alias)
    const on: string[] = new Array(breakoutAliasToIndex.size).fill('')
    for (const k of mr.on) {
      const idx = breakoutAliasToIndex.get(k.breakout)
      if (idx != null) on[idx] = k.field
    }
    crossMetrics.push({
      numFn: num.fn,
      numField: num.field,
      numWhere: groupToWhere(num.filter),
      denSource: '',
      denFn: 'count',
      denMetricId: mr.metricId,
      on,
      multiplier: calc.multiplier ?? 1,
    })
  }

  const measures: MeasureRow[] = []
  for (const m of aggs) {
    if (crossConsumed.has(m.alias)) continue
    if (m.kind === 'calc') {
      const num = baseByAlias.get(m.numerator)
      const den = m.denominator ? baseByAlias.get(m.denominator) : undefined
      measures.push({
        fn: num?.fn ?? 'count',
        field: num?.field,
        where: groupToWhere(num?.filter),
        calc: true,
        denFn: den?.fn,
        denField: den?.field,
        denWhere: groupToWhere(den?.filter),
        multiplier: m.multiplier ?? 1,
      })
    } else if (m.kind === 'expr') {
      // Custom-expression measure → an editable formula row (fn is a placeholder).
      measures.push({ fn: 'count', expr: m.expr })
    } else if (!consumed.has(m.alias)) {
      measures.push({ fn: m.fn, field: m.field, where: groupToWhere(m.filter) })
    }
  }
  const isSummarize =
    breakouts.length > 0 ||
    measures.length > 0 ||
    extraAggs.length > 0 ||
    extraBreakouts.length > 0 ||
    crossMetrics.length > 0
  return {
    entityKey: stage.source,
    mode: isSummarize ? 'summarize' : 'rows',
    columns: stage.columns ?? [],
    breakouts,
    measures,
    filters,
    pivotOn: query?.display === 'pivot' && Boolean(query.pivot),
    extraAggs,
    extraBreakouts,
    crossMetrics,
  }
}
