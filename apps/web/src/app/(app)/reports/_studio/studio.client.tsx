'use client'

// The report studio — a 1/3 ▸ 2/3 split (BuilderShell) shared with the
// inspection-type / app / document builders. LEFT rail = authoring (name → data
// source → Rows|Summarize → columns/group-by+measures → filters). RIGHT
// surface = a debounced live preview (server action, RLS-scoped, row-capped).
//
// Data sources are the full DISCOVERED catalog (every tenant-scoped table),
// passed in from the server page. Filters use react-querybuilder for the nested
// and/or tree, restyled to fit the rail; its JSON converts to/from the engine's
// ReportRuleGroup at the boundary.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { QueryBuilder, type Field, type RuleGroupType, type RuleType } from 'react-querybuilder'
import { Button, Input, Label, Select, Textarea, cn } from '@beaconhs/ui'
import {
  CheckCircle2,
  Eye,
  FileText,
  LayoutTemplate,
  Loader2,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import type {
  ReportAggFn,
  ReportCustomQuery,
  ReportLayoutConfig,
  ReportMeasure,
  ReportPaperSize,
  ReportRule,
  ReportRuleGroup,
  ReportTemporalBin,
} from '@beaconhs/db/schema'
import {
  REPORT_ENTITY_MAP,
  type ReportEntity,
  type ReportEntityColumn,
  type ReportOperatorMeta,
} from '@beaconhs/reports/entities'
import {
  BuilderRailHeader,
  BuilderScroll,
  BuilderShell,
  BuilderSurfaceHeader,
} from '@/components/builder/builder-shell'
import { ReportPagedPreview } from '../_components/report-paged-preview.client'
import { previewCustomReport, type StudioPreviewResult } from './actions'

type QueryMode = 'rows' | 'summarize'
type BreakoutRow = { column: string; bin?: ReportTemporalBin }
type MeasureRow = { fn: ReportAggFn; column?: string }
type StudioTemplate = {
  id: string
  label: string
  description: string
  query: ReportCustomQuery
}

// Client-side mirror of the engine defaults (see @beaconhs/reports/document —
// kept local so this bundle never pulls the db schema's runtime barrel). The
// server re-validates/clamps every save and preview.
const DEFAULT_LAYOUT: ReportLayoutConfig = {
  paperSize: 'letter',
  orientation: 'landscape',
  marginMm: 15,
}
const PAPER_CHOICES: { key: ReportPaperSize; label: string }[] = [
  { key: 'letter', label: 'Letter' },
  { key: 'a4', label: 'A4' },
  { key: 'legal', label: 'Legal' },
]
const STUDIO_PREVIEW_ROWS = 50

const AGG_FNS: { value: ReportAggFn; label: string; needsColumn: boolean }[] = [
  { value: 'count', label: 'Count of rows', needsColumn: false },
  { value: 'sum', label: 'Sum of', needsColumn: true },
  { value: 'avg', label: 'Average of', needsColumn: true },
  { value: 'min', label: 'Min of', needsColumn: true },
  { value: 'max', label: 'Max of', needsColumn: true },
  { value: 'count_distinct', label: 'Distinct count of', needsColumn: true },
]

const TEMPORAL_BINS: ReportTemporalBin[] = ['day', 'week', 'month', 'quarter', 'year']

const isNumberCol = (c: ReportEntityColumn) => c.kind === 'number'
const isTemporalCol = (c: ReportEntityColumn) => c.kind === 'date' || c.kind === 'timestamp'

const sectionCls =
  'rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900'
const headCls =
  'mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400'
// Layout only — <Select> supplies its own chrome (border, bg, chevron, focus ring).
const selectCls = 'h-9 w-full text-sm'

const DEFAULT_COLUMN_LIMIT = 7

function isOperationalColumn(column: ReportEntityColumn) {
  return (
    column.kind !== 'uuid' &&
    column.key !== 'id' &&
    column.key !== 'tenant_id' &&
    column.key !== 'deleted_at'
  )
}

function defaultColumnsFor(entity: ReportEntity, limit = DEFAULT_COLUMN_LIMIT): string[] {
  const preferred = entity.columns.filter(isOperationalColumn).slice(0, limit)
  return (preferred.length ? preferred : entity.columns.slice(0, limit)).map((column) => column.key)
}

function hasColumn(entity: ReportEntity, key: string | null | undefined): key is string {
  return Boolean(key && entity.columns.some((column) => column.key === key))
}

function pickExisting(entity: ReportEntity, keys: string[], fallbackLimit = DEFAULT_COLUMN_LIMIT) {
  const picked = keys.filter((key) => hasColumn(entity, key))
  return picked.length ? picked : defaultColumnsFor(entity, fallbackLimit)
}

function defaultRowsQuery(entity: ReportEntity): ReportCustomQuery {
  return {
    entity: entity.key,
    mode: 'rows',
    columns: defaultColumnsFor(entity),
    breakouts: [],
    measures: [],
    filters: [],
    filtersV2: null,
    groupBy: null,
    sort: entity.defaultSort ?? null,
    limit: 1000,
  }
}

function reportTemplatesFor(entity: ReportEntity): StudioTemplate[] {
  const templates: StudioTemplate[] = []
  const temporal =
    entity.columns.find((column) => column.key === 'month') ??
    entity.columns.find((column) => column.key.endsWith('_on')) ??
    entity.columns.find((column) => column.key.endsWith('_at')) ??
    entity.columns.find(isTemporalCol)
  const category =
    entity.columns.find((column) => column.key === 'status') ??
    entity.columns.find((column) => column.kind === 'enum') ??
    entity.columns.find((column) => column.kind === 'text' && !column.key.endsWith('_id'))
  const numberColumn =
    entity.columns.find((column) => column.key === 'total_km') ??
    entity.columns.find((column) => column.key.endsWith('_count')) ??
    entity.columns.find(isNumberCol)

  if (entity.key === 'vehicle_log_monthly') {
    templates.push({
      id: 'vehicle-log-monthly',
      label: 'Vehicle log monthly summary',
      description: 'Asset/month rollup with driver, km, hours, crew and import coverage.',
      query: {
        entity: entity.key,
        mode: 'rows',
        columns: pickExisting(entity, [
          'asset_tag',
          'vehicle_name',
          'driver_name',
          'month',
          'logged_days',
          'business_km',
          'personal_km',
          'total_km',
          'hours_on_site',
          'manpower_count',
          'imported_days',
          'manual_days',
          'site_count',
        ]),
        groupBy: hasColumn(entity, 'asset_tag') ? 'asset_tag' : null,
        sort: hasColumn(entity, 'month') ? { column: 'month', direction: 'asc' } : null,
        limit: 10000,
      },
    })
  }

  templates.push({
    id: 'detail-register',
    label: 'Detail register',
    description: 'A clean row listing with practical default columns and sorting.',
    query: defaultRowsQuery(entity),
  })

  if (category) {
    templates.push({
      id: 'grouped-register',
      label: `Grouped by ${category.label}`,
      description: 'Detail rows organized into report sections.',
      query: {
        ...defaultRowsQuery(entity),
        groupBy: category.key,
      },
    })
  }

  if (temporal) {
    templates.push({
      id: 'monthly-activity',
      label: `Monthly ${numberColumn ? 'totals' : 'activity'}`,
      description: numberColumn
        ? `Trend ${numberColumn.label.toLowerCase()} by month.`
        : 'Count records by month.',
      query: {
        entity: entity.key,
        mode: 'summarize',
        columns: [],
        breakouts: [{ column: temporal.key, bin: 'month' }],
        measures: numberColumn
          ? [{ fn: 'sum', column: numberColumn.key }, { fn: 'count' }]
          : [{ fn: 'count' }],
        filters: [],
        filtersV2: null,
        groupBy: null,
        sort: null,
        limit: 1000,
      },
    })
  }

  if (category && numberColumn) {
    templates.push({
      id: 'totals-by-category',
      label: `${numberColumn.label} by ${category.label}`,
      description: 'Rank categories by a numeric total.',
      query: {
        entity: entity.key,
        mode: 'summarize',
        columns: [],
        breakouts: [{ column: category.key }],
        measures: [{ fn: 'sum', column: numberColumn.key }, { fn: 'count' }],
        filters: [],
        filtersV2: null,
        groupBy: null,
        sort: null,
        limit: 1000,
      },
    })
  }

  return templates
}

export function ReportStudio({
  entities,
  operators,
  intent,
  initialName,
  initialDescription,
  initialEntityKey,
  initialQuery,
  initialLayout,
  cloneFromId,
  action,
}: {
  entities: ReportEntity[]
  operators: ReportOperatorMeta[]
  intent: 'create' | 'edit'
  initialName?: string
  initialDescription?: string
  initialEntityKey?: string | null
  initialQuery?: ReportCustomQuery | null
  initialLayout?: ReportLayoutConfig | null
  cloneFromId?: string | null
  action: (formData: FormData) => Promise<void>
}) {
  // Build the working catalog: the discovered list, plus the legacy static
  // entity being edited if its key isn't in the discovered set (so old saved
  // reports still open without the picker exploding to all legacy entries).
  const catalog = useMemo(() => {
    const startKey = initialQuery?.entity ?? initialEntityKey ?? null
    if (startKey && !entities.some((e) => e.key === startKey) && REPORT_ENTITY_MAP[startKey]) {
      return [REPORT_ENTITY_MAP[startKey]!, ...entities]
    }
    return entities
  }, [entities, initialQuery?.entity, initialEntityKey])

  const fallbackEntity = catalog[0]!.key
  const [entityKey, setEntityKey] = useState<string>(
    initialQuery?.entity ??
      (initialEntityKey && catalog.some((e) => e.key === initialEntityKey)
        ? initialEntityKey
        : fallbackEntity),
  )
  const entity = useMemo(
    () => catalog.find((e) => e.key === entityKey) ?? catalog[0]!,
    [catalog, entityKey],
  )

  // Entity picker grouped by category (discovery order).
  const entityGroups = useMemo(() => {
    const m = new Map<string, ReportEntity[]>()
    for (const e of catalog) {
      const arr = m.get(e.category) ?? []
      arr.push(e)
      m.set(e.category, arr)
    }
    return [...m.entries()]
  }, [catalog])

  const [name, setName] = useState(initialName ?? '')
  const [description, setDescription] = useState(initialDescription ?? '')
  const [queryMode, setQueryMode] = useState<QueryMode>(
    initialQuery?.mode === 'summarize' ? 'summarize' : 'rows',
  )
  const [columns, setColumns] = useState<Set<string>>(
    () => new Set(initialQuery?.columns?.length ? initialQuery.columns : defaultColumnsFor(entity)),
  )
  const [breakouts, setBreakouts] = useState<BreakoutRow[]>(() =>
    (initialQuery?.breakouts ?? []).map((b) => ({ column: b.column, bin: b.bin })),
  )
  const [measures, setMeasures] = useState<MeasureRow[]>(() =>
    (initialQuery?.measures ?? []).map((m) => ({ fn: m.fn, column: m.column })),
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
  const [layout, setLayout] = useState<ReportLayoutConfig>(() => ({
    ...DEFAULT_LAYOUT,
    ...(initialLayout ?? {}),
  }))
  const [columnSearch, setColumnSearch] = useState('')

  // react-querybuilder assigns random ids, which never match between SSR and
  // hydration — render it client-only behind a mount gate.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  function hydrateQuery(nextEntity: ReportEntity, query: ReportCustomQuery) {
    const validColumns = query.columns?.filter((column) => hasColumn(nextEntity, column)) ?? []
    const validBreakouts = (query.breakouts ?? []).filter((breakout) =>
      hasColumn(nextEntity, breakout.column),
    )
    const validMeasures = (query.measures ?? []).filter(
      (measure) => measure.fn === 'count' || hasColumn(nextEntity, measure.column),
    )
    const nextSort =
      query.sort?.column && hasColumn(nextEntity, query.sort.column) ? query.sort : null

    setEntityKey(nextEntity.key)
    setQueryMode(query.mode === 'summarize' ? 'summarize' : 'rows')
    setColumns(new Set(validColumns.length ? validColumns : defaultColumnsFor(nextEntity)))
    setBreakouts(validBreakouts.map((breakout) => ({ column: breakout.column, bin: breakout.bin })))
    setMeasures(validMeasures.map((measure) => ({ fn: measure.fn, column: measure.column })))
    setRqbQuery(fromEngineGroup(query))
    setGroupBy(hasColumn(nextEntity, query.groupBy) ? (query.groupBy ?? '') : '')
    setSortCol(nextSort?.column ?? nextEntity.defaultSort?.column ?? '')
    setSortDir(nextSort?.direction ?? nextEntity.defaultSort?.direction ?? 'desc')
    setLimit(query.limit ?? 1000)
    setColumnSearch('')
  }

  function changeEntity(newKey: string) {
    const newEnt = catalog.find((e) => e.key === newKey)!
    hydrateQuery(newEnt, defaultRowsQuery(newEnt))
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
    if (queryMode === 'summarize') {
      const bks = breakouts.filter((b) => b.column)
      const mss: ReportMeasure[] = measures
        .filter((m) => m.fn === 'count' || m.column)
        .map((m) => ({ fn: m.fn, ...(m.fn === 'count' ? {} : { column: m.column }) }))
      return {
        entity: entityKey,
        mode: 'summarize',
        columns: [],
        breakouts: bks,
        measures: mss.length ? mss : [{ fn: 'count' }],
        filters: [],
        filtersV2,
        groupBy: null,
        sort: null,
        limit,
      }
    }
    return {
      entity: entityKey,
      mode: 'rows',
      columns: Array.from(columns),
      breakouts: [],
      measures: [],
      filters: [],
      filtersV2,
      groupBy: groupBy || null,
      sort: sortCol ? { column: sortCol, direction: sortDir } : null,
      limit,
    }
  }, [
    entityKey,
    entity,
    queryMode,
    columns,
    breakouts,
    measures,
    rqbQuery,
    groupBy,
    sortCol,
    sortDir,
    limit,
  ])

  // --- Live preview ---------------------------------------------------------

  const [preview, setPreview] = useState<StudioPreviewResult | null>(null)
  const [isPreviewing, startPreview] = useTransition()
  const previewKey = useMemo(
    () => JSON.stringify({ query: customQuery, layout, name }),
    [customQuery, layout, name],
  )
  const latest = useRef(previewKey)
  const hasSomething =
    queryMode === 'rows' ? columns.size > 0 : breakouts.length > 0 || measures.length > 0
  useEffect(() => {
    latest.current = previewKey
    if (!hasSomething) return
    const t = setTimeout(() => {
      startPreview(async () => {
        const res = await previewCustomReport(JSON.parse(previewKey))
        if (latest.current === previewKey) setPreview(res)
      })
    }, 600)
    return () => clearTimeout(t)
  }, [previewKey, hasSomething])

  const fields: Field[] = useMemo(
    () => entity.columns.map((c) => ({ name: c.key, label: c.label })),
    [entity],
  )
  const studioTemplates = useMemo(() => reportTemplatesFor(entity), [entity])
  const visibleColumnOptions = useMemo(() => {
    const q = columnSearch.trim().toLowerCase()
    if (!q) return entity.columns
    return entity.columns.filter((column) =>
      `${column.label} ${column.key}`.toLowerCase().includes(q),
    )
  }, [entity, columnSearch])
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

  const canSave =
    name.trim().length > 0 &&
    (queryMode === 'rows'
      ? columns.size > 0
      : measures.some((m) => m.fn === 'count' || m.column) || breakouts.some((b) => b.column))

  const inputCls =
    'h-8 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
  const tinyBtn =
    'inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-700 transition-colors hover:border-teal-400 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'

  return (
    <form action={action} className="flex h-full min-h-0 flex-col">
      <input type="hidden" name="customQuery" value={JSON.stringify(customQuery)} />
      <input type="hidden" name="layout" value={JSON.stringify(layout)} />
      <input type="hidden" name="cloneFromId" value={cloneFromId ?? ''} />

      <div className="min-h-0 flex-1">
        <BuilderShell
          left={
            <>
              <BuilderRailHeader
                icon={<FileText size={15} />}
                title={intent === 'edit' ? 'Edit report' : 'New report'}
                subtitle="Configure data and shape"
              />
              <BuilderScroll className="space-y-3">
                {/* Name */}
                <div className={sectionCls}>
                  <div className="space-y-2.5">
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
                </div>

                {/* Data source */}
                <div className={sectionCls}>
                  <h3 className={headCls}>Data source</h3>
                  <Select
                    value={entityKey}
                    onChange={(e) => changeEntity(e.target.value)}
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
                  </Select>
                  {entity.description ? (
                    <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {entity.description}
                    </p>
                  ) : null}
                  <div className="mt-3 inline-flex rounded-md border border-slate-200 p-0.5 dark:border-slate-700">
                    {(['rows', 'summarize'] as QueryMode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setQueryMode(m)}
                        className={cn(
                          'rounded px-3 py-1 text-xs font-medium transition',
                          queryMode === m
                            ? 'bg-teal-600 text-white'
                            : 'text-slate-500 hover:text-slate-800 dark:text-slate-400',
                        )}
                      >
                        {m === 'rows' ? 'Detail rows' : 'Summarize'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={sectionCls}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className={cn(headCls, 'mb-0')}>Templates</h3>
                    <LayoutTemplate size={14} className="text-slate-400" />
                  </div>
                  <div className="space-y-1.5">
                    {studioTemplates.map((template) => {
                      const active =
                        template.query.mode === queryMode &&
                        template.query.entity === entityKey &&
                        JSON.stringify(template.query.columns ?? []) ===
                          JSON.stringify(Array.from(columns)) &&
                        (template.query.groupBy ?? '') === groupBy
                      return (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => hydrateQuery(entity, template.query)}
                          className={cn(
                            'flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors',
                            active
                              ? 'border-teal-300 bg-teal-50 text-teal-900 dark:border-teal-700/70 dark:bg-teal-500/10 dark:text-teal-100'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-teal-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-teal-700',
                          )}
                        >
                          <CheckCircle2
                            size={14}
                            className={cn(
                              'mt-0.5 shrink-0',
                              active ? 'text-teal-600' : 'text-slate-300',
                            )}
                          />
                          <span className="min-w-0">
                            <span className="block text-xs font-medium">{template.label}</span>
                            <span className="mt-0.5 block text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                              {template.description}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Rows mode: columns + sort + limit */}
                {queryMode === 'rows' ? (
                  <>
                    <div className={sectionCls}>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h3 className={cn(headCls, 'mb-0')}>Columns</h3>
                        <span className="text-[11px] text-slate-400">
                          {columns.size}/{entity.columns.length}
                        </span>
                      </div>
                      <div className="relative mb-2">
                        <Search
                          size={13}
                          className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-slate-400"
                        />
                        <Input
                          value={columnSearch}
                          onChange={(e) => setColumnSearch(e.target.value)}
                          placeholder="Search fields"
                          className="h-8 pl-7 text-xs"
                        />
                      </div>
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => setColumns(new Set(defaultColumnsFor(entity)))}
                          className={tinyBtn}
                        >
                          Defaults
                        </button>
                        <button
                          type="button"
                          onClick={() => setColumns(new Set(entity.columns.map((c) => c.key)))}
                          className={tinyBtn}
                        >
                          All
                        </button>
                        <button
                          type="button"
                          onClick={() => setColumns(new Set())}
                          className={tinyBtn}
                        >
                          Clear
                        </button>
                      </div>
                      <div className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto pr-1">
                        {visibleColumnOptions.map((c) => (
                          <label
                            key={c.key}
                            className={cn(
                              'flex items-center gap-2 rounded-md px-1.5 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60',
                              columns.has(c.key) && 'bg-teal-50/70 dark:bg-teal-500/10',
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={columns.has(c.key)}
                              onChange={() => toggleColumn(c.key)}
                              className="h-3.5 w-3.5"
                            />
                            <span className="truncate">{c.label}</span>
                            <span className="ml-auto shrink-0 text-[10px] text-slate-400">
                              {c.kind}
                            </span>
                          </label>
                        ))}
                      </div>
                      {visibleColumnOptions.length === 0 ? (
                        <p className="rounded-md border border-dashed border-slate-200 px-2 py-4 text-center text-[11px] text-slate-400 dark:border-slate-800">
                          No matching fields.
                        </p>
                      ) : null}
                    </div>

                    <div className={sectionCls}>
                      <h3 className={headCls}>Sort & limit</h3>
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <Select value={sortCol} onChange={(e) => setSortCol(e.target.value)}>
                            <option value="">— No sort —</option>
                            {entity.columns.map((c) => (
                              <option key={c.key} value={c.key}>
                                {c.label}
                              </option>
                            ))}
                          </Select>
                          <Select
                            value={sortDir}
                            onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}
                          >
                            <option value="desc">Descending</option>
                            <option value="asc">Ascending</option>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label>Group rows into sections by</Label>
                          <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                            <option value="">— No grouping —</option>
                            {entity.columns.map((c) => (
                              <option key={c.key} value={c.key}>
                                {c.label}
                              </option>
                            ))}
                          </Select>
                        </div>
                        <div className="space-y-1">
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
                    </div>
                  </>
                ) : (
                  // Summarize mode: breakouts + measures
                  <>
                    <RailList
                      title="Group by"
                      addLabel="Add group"
                      items={breakouts}
                      onAdd={() =>
                        setBreakouts((b) => [...b, { column: entity.columns[0]?.key ?? '' }])
                      }
                      onRemove={(i) => setBreakouts((b) => b.filter((_, j) => j !== i))}
                      render={(b, i) => (
                        <BreakoutEditor
                          cols={entity.columns}
                          row={b}
                          onChange={(next) =>
                            setBreakouts((bs) => bs.map((x, j) => (j === i ? next : x)))
                          }
                        />
                      )}
                    />
                    <RailList
                      title="Measures"
                      addLabel="Add measure"
                      items={measures}
                      onAdd={() => setMeasures((m) => [...m, { fn: 'count' }])}
                      onRemove={(i) => setMeasures((m) => m.filter((_, j) => j !== i))}
                      render={(m, i) => (
                        <MeasureEditor
                          cols={entity.columns}
                          row={m}
                          onChange={(next) =>
                            setMeasures((ms) => ms.map((x, j) => (j === i ? next : x)))
                          }
                        />
                      )}
                    />
                    <div className={sectionCls}>
                      <Label>Row limit</Label>
                      <Input
                        type="number"
                        min={1}
                        max={10000}
                        value={limit}
                        onChange={(e) => setLimit(Number(e.target.value) || 1000)}
                        className="mt-1"
                      />
                    </div>
                  </>
                )}

                {/* Filters */}
                <div className={sectionCls}>
                  <h3 className={headCls}>Filters</h3>
                  {!mounted ? (
                    <div className="h-16 animate-pulse rounded-lg border border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/50" />
                  ) : (
                    <QueryBuilder
                      fields={fields}
                      query={rqbQuery}
                      onQueryChange={setRqbQuery}
                      getOperators={getOperators}
                      controlClassnames={{
                        queryBuilder: 'space-y-2',
                        ruleGroup:
                          'space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2 dark:border-slate-800 dark:bg-slate-900/50',
                        header: 'flex flex-wrap items-center gap-1.5',
                        body: 'space-y-1.5',
                        rule: 'flex flex-wrap items-center gap-1.5',
                        combinators: inputCls,
                        fields: cn(inputCls, 'max-w-full'),
                        operators: cn(inputCls, 'max-w-full'),
                        value: cn(inputCls, 'min-w-24 flex-1'),
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
                  <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
                    List values are comma-separated.
                  </p>
                </div>

                {/* Page setup */}
                <div className={sectionCls}>
                  <h3 className={headCls}>Page setup</h3>
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label>Paper</Label>
                        <Select
                          value={layout.paperSize}
                          onChange={(e) =>
                            setLayout((l) => ({
                              ...l,
                              paperSize: e.target.value as ReportPaperSize,
                            }))
                          }
                          className={selectCls}
                        >
                          {PAPER_CHOICES.map((p) => (
                            <option key={p.key} value={p.key}>
                              {p.label}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label>Margin (mm)</Label>
                        <Input
                          type="number"
                          min={5}
                          max={30}
                          value={layout.marginMm}
                          onChange={(e) =>
                            setLayout((l) => ({
                              ...l,
                              marginMm: Math.min(Math.max(Number(e.target.value) || 15, 5), 30),
                            }))
                          }
                        />
                      </div>
                    </div>
                    <div className="inline-flex rounded-md border border-slate-200 p-0.5 dark:border-slate-700">
                      {(['landscape', 'portrait'] as const).map((o) => (
                        <button
                          key={o}
                          type="button"
                          onClick={() => setLayout((l) => ({ ...l, orientation: o }))}
                          className={cn(
                            'rounded px-3 py-1 text-xs font-medium transition',
                            layout.orientation === o
                              ? 'bg-teal-600 text-white'
                              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400',
                          )}
                        >
                          {o === 'landscape' ? 'Landscape' : 'Portrait'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </BuilderScroll>
            </>
          }
          right={
            <>
              <BuilderSurfaceHeader
                icon={<Eye size={15} className="text-teal-600" />}
                title="Print preview"
                actions={
                  <>
                    {isPreviewing ? (
                      <span className="flex items-center gap-1.5 text-xs text-slate-400">
                        <Loader2 size={12} className="animate-spin" /> running…
                      </span>
                    ) : preview?.ok ? (
                      <span className="text-xs text-slate-400">
                        {preview.rowCount} row{preview.rowCount === 1 ? '' : 's'}
                      </span>
                    ) : null}
                    <Button type="submit" size="sm" disabled={!canSave}>
                      {intent === 'edit' ? 'Save changes' : 'Save report'}
                    </Button>
                  </>
                }
              />
              <div className="min-h-0 flex-1">
                {!preview ? (
                  <p className="py-16 text-center text-sm text-slate-400">
                    Preview updates automatically as you build.
                  </p>
                ) : !preview.ok ? (
                  <div className="p-4 lg:p-6">
                    <div className="rounded-xl border border-dashed border-rose-300 bg-rose-50/40 px-4 py-8 text-center text-sm text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/5 dark:text-rose-400">
                      {preview.error}
                    </div>
                  </div>
                ) : (
                  <ReportPagedPreview
                    bodyHtml={preview.bodyHtml}
                    css={preview.css}
                    caption={
                      preview.rowCount >= STUDIO_PREVIEW_ROWS
                        ? `Preview paginates the first ${STUDIO_PREVIEW_ROWS} rows; saved reports use the configured row limit.`
                        : null
                    }
                  />
                )}
              </div>
            </>
          }
        />
      </div>
    </form>
  )
}

// --- rail building blocks ----------------------------------------------------

function RailList<T>({
  title,
  addLabel,
  items,
  onAdd,
  onRemove,
  render,
}: {
  title: string
  addLabel: string
  items: T[]
  onAdd: () => void
  onRemove: (i: number) => void
  render: (item: T, i: number) => React.ReactNode
}) {
  return (
    <div className={sectionCls}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className={cn(headCls, 'mb-0')}>{title}</h3>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-700"
        >
          <Plus size={13} /> {addLabel}
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
  cols: ReportEntityColumn[]
  row: BreakoutRow
  onChange: (next: BreakoutRow) => void
}) {
  const col = cols.find((c) => c.key === row.column)
  return (
    <div className="space-y-1">
      <Select
        value={row.column}
        onChange={(e) => onChange({ column: e.target.value, bin: undefined })}
        className={cn(selectCls, 'h-8 text-xs')}
      >
        {cols.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </Select>
      {col && isTemporalCol(col) ? (
        <Select
          value={row.bin ?? ''}
          onChange={(e) =>
            onChange({
              ...row,
              bin: (e.target.value || undefined) as ReportTemporalBin | undefined,
            })
          }
          className={cn(selectCls, 'h-8 text-xs')}
        >
          <option value="">No bucket</option>
          {TEMPORAL_BINS.map((u) => (
            <option key={u} value={u}>
              by {u}
            </option>
          ))}
        </Select>
      ) : null}
    </div>
  )
}

function MeasureEditor({
  cols,
  row,
  onChange,
}: {
  cols: ReportEntityColumn[]
  row: MeasureRow
  onChange: (next: MeasureRow) => void
}) {
  const def = AGG_FNS.find((a) => a.value === row.fn)
  const fieldCols = row.fn === 'sum' || row.fn === 'avg' ? cols.filter(isNumberCol) : cols
  return (
    <div className="space-y-1">
      <Select
        value={row.fn}
        onChange={(e) => onChange({ ...row, fn: e.target.value as ReportAggFn })}
        className={cn(selectCls, 'h-8 text-xs')}
      >
        {AGG_FNS.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </Select>
      {def?.needsColumn ? (
        <Select
          value={row.column ?? ''}
          onChange={(e) => onChange({ ...row, column: e.target.value })}
          className={cn(selectCls, 'h-8 text-xs')}
        >
          <option value="">Pick a column…</option>
          {fieldCols.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </Select>
      ) : null}
    </div>
  )
}

// --- RQB ⇄ engine conversion -------------------------------------------------

/** react-querybuilder rule JSON → the engine's stored ReportRuleGroup. */
function toEngineGroup(group: RuleGroupType, entity: ReportEntity): ReportRuleGroup | null {
  function walkGroup(g: RuleGroupType): ReportRuleGroup {
    const rules: (ReportRule | ReportRuleGroup)[] = []
    for (const r of g.rules) {
      if (typeof r === 'string') continue
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
    if (op === 'between_days_ago' || op === 'due_within_days') {
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

/** Stored plan → react-querybuilder state. Migrates v1 flat filters when no v2
 *  tree exists so older definitions open cleanly. */
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
