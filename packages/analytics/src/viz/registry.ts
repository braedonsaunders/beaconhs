// Visualization registry — a Metabase-parity declarative catalog. Each VizDef
// states the data shape it consumes, whether it's a SENSIBLE auto-pick for a
// given result (`isSensible`), a hard render check that throws a user-facing
// message (`checkRenderable`), and a declarative settings schema. Pure + React-
// free: the renderer maps `iconKey` (a lucide name) to a component and reads
// `settings` to draw the config panel.

import type { BhqlResult, ResultColumn, ResultShape } from '../result'
import type { SemanticType } from '../semantic'

export type VizKey =
  | 'scalar'
  | 'progress'
  | 'table'
  | 'pivot'
  | 'heatmap'
  | 'bar'
  | 'row'
  | 'line'
  | 'area'
  | 'combo'
  | 'pie'
  | 'donut'
  | 'funnel'
  | 'gauge'
  | 'scatter'

export type VizDataShape = 'scalar' | 'rows' | 'rows-series' | 'pivot-matrix'
export type VizGroup = 'numbers' | 'tables' | 'comparison' | 'trend' | 'proportion' | 'relationship'

export type VizSettingWidget =
  | 'select'
  | 'number'
  | 'color'
  | 'toggle'
  | 'text'
  | 'field'
  | 'conditional-format'

export type VizSettingContext = {
  shape: ResultShape
  columns: ResultColumn[]
}

export type VizSettingDef = {
  key: string
  label: string
  widget: VizSettingWidget
  section?: string
  options?: { value: string; label: string }[]
  getDefault?: (ctx: VizSettingContext) => unknown
}

export type VizSettings = Record<string, unknown>

export type GridSize = { w: number; h: number }

export type VizDef = {
  key: VizKey
  label: string
  /** lucide-react icon name; resolved client-side so the registry stays React-free. */
  iconKey: string
  group: VizGroup
  consumes: VizDataShape
  minSize: GridSize
  defaultSize: GridSize
  /** Is this a good DEFAULT pick for the given result? (auto-suggest) */
  isSensible: (
    shape: ResultShape,
    semanticTypes: SemanticType[],
    columns: ResultColumn[],
  ) => boolean
  /** Tie-break among sensible vizzes; higher wins. */
  sensibleRank: number
  /** Throw a user-facing Error if the data/settings can't render. */
  checkRenderable: (data: BhqlResult, settings: VizSettings) => void
  settings: VizSettingDef[]
}

// --- shared helpers ---------------------------------------------------------

const dims = (cols: ResultColumn[]) => cols.filter((c) => c.role === 'dimension')
const measures = (cols: ResultColumn[]) => cols.filter((c) => c.role === 'measure')

function requireFlat(data: BhqlResult): asserts data is Extract<BhqlResult, { shape: 'flat' }> {
  if (data.shape !== 'flat') throw new Error('This visualization needs a non-pivot result')
}

const KPI: GridSize = { w: 3, h: 2 }
const CHART: GridSize = { w: 6, h: 4 }
const BIG: GridSize = { w: 8, h: 6 }

// --- the catalog ------------------------------------------------------------

export const VIZ_DEFS: Record<VizKey, VizDef> = {
  scalar: {
    key: 'scalar',
    label: 'Number',
    iconKey: 'Hash',
    group: 'numbers',
    consumes: 'scalar',
    minSize: { w: 2, h: 2 },
    defaultSize: KPI,
    sensibleRank: 10,
    isSensible: (shape, _t, cols) =>
      shape === 'scalar' || (dims(cols).length === 0 && measures(cols).length >= 1),
    checkRenderable: (data) => {
      requireFlat(data)
      if (measures(data.columns).length === 0) throw new Error('Add a measure to show a number')
    },
    settings: [
      { key: 'valueField', label: 'Value', widget: 'field', section: 'Data' },
      { key: 'compareField', label: 'Compare to', widget: 'field', section: 'Data' },
      { key: 'decimals', label: 'Decimals', widget: 'number', section: 'Format' },
      { key: 'prefix', label: 'Prefix', widget: 'text', section: 'Format' },
      { key: 'suffix', label: 'Suffix', widget: 'text', section: 'Format' },
    ],
  },
  progress: {
    key: 'progress',
    label: 'Progress',
    iconKey: 'Gauge',
    group: 'numbers',
    consumes: 'scalar',
    minSize: { w: 3, h: 2 },
    defaultSize: { w: 4, h: 2 },
    sensibleRank: 5,
    isSensible: (shape, types) => shape === 'scalar' && types.includes('percentage'),
    checkRenderable: (data) => {
      requireFlat(data)
      if (measures(data.columns).length === 0) throw new Error('Add a measure to show progress')
    },
    settings: [
      { key: 'valueField', label: 'Value', widget: 'field', section: 'Data' },
      { key: 'goal', label: 'Goal', widget: 'number', section: 'Data' },
    ],
  },
  table: {
    key: 'table',
    label: 'Table',
    iconKey: 'Table',
    group: 'tables',
    consumes: 'rows',
    minSize: { w: 3, h: 3 },
    defaultSize: BIG,
    sensibleRank: 0, // universal fallback
    isSensible: () => true,
    checkRenderable: (data) => {
      if (data.shape !== 'flat') throw new Error('Switch to a pivot to see this result')
    },
    settings: [
      { key: 'conditionalFormats', label: 'Conditional formatting', widget: 'conditional-format' },
    ],
  },
  pivot: {
    key: 'pivot',
    label: 'Pivot table',
    iconKey: 'Grid3x3',
    group: 'tables',
    consumes: 'pivot-matrix',
    minSize: { w: 4, h: 4 },
    defaultSize: BIG,
    sensibleRank: 10,
    isSensible: (shape) => shape === 'pivot',
    checkRenderable: (data) => {
      if (data.shape !== 'pivot')
        throw new Error('Summarize as a pivot (rows + columns + values) first')
    },
    settings: [
      { key: 'showRowTotals', label: 'Row totals', widget: 'toggle' },
      { key: 'showColumnTotals', label: 'Column totals', widget: 'toggle' },
      { key: 'conditionalFormats', label: 'Conditional formatting', widget: 'conditional-format' },
    ],
  },
  heatmap: {
    key: 'heatmap',
    label: 'Heatmap',
    iconKey: 'Grid2x2',
    group: 'tables',
    consumes: 'pivot-matrix',
    minSize: { w: 4, h: 4 },
    defaultSize: BIG,
    sensibleRank: 8,
    isSensible: (shape, _t, cols) => shape === 'pivot' && measures(cols).length === 1,
    checkRenderable: (data) => {
      if (data.shape !== 'pivot') throw new Error('Summarize as a pivot first')
    },
    settings: [{ key: 'colorScale', label: 'Color scale', widget: 'conditional-format' }],
  },
  bar: {
    key: 'bar',
    label: 'Bar',
    iconKey: 'BarChart3',
    group: 'comparison',
    consumes: 'rows-series',
    minSize: { w: 3, h: 3 },
    defaultSize: CHART,
    sensibleRank: 6,
    isSensible: (shape, _t, cols) =>
      shape === 'rows' && dims(cols).length >= 1 && measures(cols).length >= 1,
    checkRenderable: (data) => {
      requireFlat(data)
      if (measures(data.columns).length === 0) throw new Error('Add a measure to chart')
    },
    settings: [
      { key: 'stacked', label: 'Stacked', widget: 'toggle' },
      { key: 'showValues', label: 'Show values', widget: 'toggle' },
    ],
  },
  row: {
    key: 'row',
    label: 'Row chart',
    iconKey: 'AlignStartVertical',
    group: 'comparison',
    consumes: 'rows-series',
    minSize: { w: 3, h: 3 },
    defaultSize: CHART,
    sensibleRank: 5,
    isSensible: (shape, _t, cols) => {
      const d = dims(cols)
      return (
        shape === 'rows' &&
        d.length === 1 &&
        d[0]?.semanticType === 'entity-name' &&
        measures(cols).length >= 1
      )
    },
    checkRenderable: (data) => {
      requireFlat(data)
      if (measures(data.columns).length === 0) throw new Error('Add a measure to chart')
    },
    settings: [{ key: 'showValues', label: 'Show values', widget: 'toggle' }],
  },
  line: {
    key: 'line',
    label: 'Line',
    iconKey: 'LineChart',
    group: 'trend',
    consumes: 'rows-series',
    minSize: { w: 3, h: 3 },
    defaultSize: CHART,
    sensibleRank: 9,
    isSensible: (shape, _t, cols) => {
      const d = dims(cols)
      return shape === 'rows' && d[0]?.semanticType === 'temporal' && measures(cols).length >= 1
    },
    checkRenderable: (data) => {
      requireFlat(data)
      if (measures(data.columns).length === 0) throw new Error('Add a measure to chart')
    },
    settings: [
      { key: 'smooth', label: 'Smooth', widget: 'toggle' },
      { key: 'markers', label: 'Markers', widget: 'toggle' },
    ],
  },
  area: {
    key: 'area',
    label: 'Area',
    iconKey: 'AreaChart',
    group: 'trend',
    consumes: 'rows-series',
    minSize: { w: 3, h: 3 },
    defaultSize: CHART,
    sensibleRank: 7,
    isSensible: (shape, _t, cols) => {
      const d = dims(cols)
      return shape === 'rows' && d[0]?.semanticType === 'temporal' && measures(cols).length >= 1
    },
    checkRenderable: (data) => {
      requireFlat(data)
      if (measures(data.columns).length === 0) throw new Error('Add a measure to chart')
    },
    settings: [
      { key: 'stacked', label: 'Stacked', widget: 'toggle' },
      { key: 'smooth', label: 'Smooth', widget: 'toggle' },
    ],
  },
  combo: {
    key: 'combo',
    label: 'Combo',
    iconKey: 'ChartNoAxesCombined',
    group: 'comparison',
    consumes: 'rows-series',
    minSize: { w: 4, h: 3 },
    defaultSize: CHART,
    sensibleRank: 4,
    isSensible: (shape, _t, cols) =>
      shape === 'rows' && dims(cols).length >= 1 && measures(cols).length >= 2,
    checkRenderable: (data) => {
      requireFlat(data)
      if (measures(data.columns).length < 2)
        throw new Error('Combo charts need at least two measures')
    },
    settings: [],
  },
  pie: {
    key: 'pie',
    label: 'Pie',
    iconKey: 'PieChart',
    group: 'proportion',
    consumes: 'rows-series',
    minSize: { w: 3, h: 3 },
    defaultSize: CHART,
    sensibleRank: 5,
    isSensible: (shape, _t, cols) =>
      shape === 'rows' && dims(cols).length === 1 && measures(cols).length === 1,
    checkRenderable: (data) => {
      requireFlat(data)
      if (dims(data.columns).length !== 1 || measures(data.columns).length !== 1) {
        throw new Error('Pie charts need one dimension and one measure')
      }
    },
    settings: [{ key: 'showLegend', label: 'Legend', widget: 'toggle' }],
  },
  donut: {
    key: 'donut',
    label: 'Donut',
    iconKey: 'CircleDashed',
    group: 'proportion',
    consumes: 'rows-series',
    minSize: { w: 3, h: 3 },
    defaultSize: CHART,
    sensibleRank: 5,
    isSensible: (shape, _t, cols) =>
      shape === 'rows' && dims(cols).length === 1 && measures(cols).length === 1,
    checkRenderable: (data) => {
      requireFlat(data)
      if (dims(data.columns).length !== 1 || measures(data.columns).length !== 1) {
        throw new Error('Donut charts need one dimension and one measure')
      }
    },
    settings: [{ key: 'showLegend', label: 'Legend', widget: 'toggle' }],
  },
  funnel: {
    key: 'funnel',
    label: 'Funnel',
    iconKey: 'Filter',
    group: 'proportion',
    consumes: 'rows-series',
    minSize: { w: 3, h: 3 },
    defaultSize: CHART,
    sensibleRank: 2,
    isSensible: (shape, _t, cols) =>
      shape === 'rows' && dims(cols).length === 1 && measures(cols).length === 1,
    checkRenderable: (data) => {
      requireFlat(data)
      if (measures(data.columns).length !== 1) throw new Error('Funnel charts need one measure')
    },
    settings: [],
  },
  gauge: {
    key: 'gauge',
    label: 'Gauge',
    iconKey: 'Gauge',
    group: 'numbers',
    consumes: 'scalar',
    minSize: { w: 3, h: 3 },
    defaultSize: { w: 4, h: 3 },
    sensibleRank: 3,
    isSensible: (shape, _t, cols) => shape === 'scalar' && measures(cols).length === 1,
    checkRenderable: (data) => {
      requireFlat(data)
      if (measures(data.columns).length === 0) throw new Error('Add a measure for the gauge')
    },
    settings: [
      { key: 'min', label: 'Min', widget: 'number' },
      { key: 'max', label: 'Max', widget: 'number' },
    ],
  },
  scatter: {
    key: 'scatter',
    label: 'Scatter',
    iconKey: 'ScatterChart',
    group: 'relationship',
    consumes: 'rows',
    minSize: { w: 4, h: 3 },
    defaultSize: CHART,
    sensibleRank: 2,
    isSensible: (shape, _t, cols) => shape === 'rows' && measures(cols).length >= 2,
    checkRenderable: (data) => {
      requireFlat(data)
      if (measures(data.columns).length < 2) throw new Error('Scatter charts need two measures')
    },
    settings: [],
  },
}

export const VIZ_LIST: VizDef[] = Object.values(VIZ_DEFS)

export function vizDef(key: string): VizDef | undefined {
  return VIZ_DEFS[key as VizKey]
}

/** Auto-pick the best default visualization for a result. Table is the universal
 *  fallback (rank 0), so this never returns undefined. */
export function suggestViz(
  shape: ResultShape,
  semanticTypes: SemanticType[],
  columns: ResultColumn[],
): VizKey {
  const candidates = VIZ_LIST.filter((v) => v.isSensible(shape, semanticTypes, columns)).sort(
    (a, b) => b.sensibleRank - a.sensibleRank,
  )
  return candidates[0]?.key ?? 'table'
}

/** Validate before render; returns a discriminated result for the renderer. */
export function validateRenderable(
  key: string,
  data: BhqlResult,
  settings: VizSettings,
): { ok: true } | { ok: false; message: string } {
  const def = vizDef(key)
  if (!def) return { ok: false, message: `Unknown visualization "${key}"` }
  try {
    def.checkRenderable(data, settings)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Cannot render' }
  }
}

/** Default settings for a (viz, result) pair. */
export function defaultSettings(key: string, ctx: VizSettingContext): VizSettings {
  const def = vizDef(key)
  if (!def) return {}
  const out: VizSettings = {}
  for (const s of def.settings) {
    if (s.getDefault) out[s.key] = s.getDefault(ctx)
  }
  return out
}
