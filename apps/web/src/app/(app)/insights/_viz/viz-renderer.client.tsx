'use client'

// The dispatcher: given a viz type + a query result + settings, validate and
// render the right component. Chart types go through buildChartSpec → VizChart;
// table/pivot/scalar/progress render directly. Used by dashboard cells AND the
// builder preview.

import dynamic from 'next/dynamic'
import {
  buildChartSpec,
  validateRenderable,
  type BhqlResult,
  type CfRule,
  type FlatResult,
  type PivotResult,
  type VizSettings,
} from '@beaconhs/analytics'
import { DataTable } from './data-table.client'
import { PivotTable } from './pivot-table.client'
import { ProgressCard } from './progress-card.client'
import { ScalarCard } from './scalar-card.client'

// ECharts is heavy + client-only — defer it so DOM vizzes never pay for it.
const VizChart = dynamic(() => import('./viz-chart.client').then((m) => m.VizChart), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
  ),
})

const CHART_KEYS = new Set([
  'bar',
  'row',
  'line',
  'area',
  'combo',
  'pie',
  'donut',
  'funnel',
  'gauge',
  'scatter',
])

/** For a heatmap, derive a numeric color-scale across the value measure when the
 *  user hasn't configured one. */
function heatmapSettings(result: PivotResult, settings: VizSettings): VizSettings {
  if ((settings.conditionalFormats as CfRule[] | undefined)?.length) return settings
  const value = result.valueMeasures[0]
  if (!value || value.dataType !== 'number') return settings
  let min = Infinity
  let max = -Infinity
  for (const row of result.cells) {
    for (const cell of row) {
      const n = cell ? Number(cell[value.key]) : NaN
      if (Number.isFinite(n)) {
        if (n < min) min = n
        if (n > max) max = n
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return settings
  const rule: CfRule = {
    type: 'colorScale',
    column: value.key,
    min,
    max,
    minColor: 'slate',
    maxColor: 'teal',
  }
  return { ...settings, conditionalFormats: [rule] }
}

export function VizRenderer({
  vizType,
  result,
  settings = {},
  label,
}: {
  vizType: string
  result: BhqlResult
  settings?: VizSettings
  label?: string
}) {
  const check = validateRenderable(vizType, result, settings)
  if (!check.ok) {
    return (
      <div className="grid h-full place-items-center rounded-lg border border-dashed border-amber-300 bg-amber-50/40 px-4 text-center text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/5 dark:text-amber-400">
        {check.message}
      </div>
    )
  }

  if (vizType === 'pivot') {
    return <PivotTable result={result as PivotResult} settings={settings} />
  }
  if (vizType === 'heatmap') {
    const pivot = result as PivotResult
    return <PivotTable result={pivot} settings={heatmapSettings(pivot, settings)} />
  }
  if (vizType === 'table') {
    return <DataTable result={result as FlatResult} settings={settings} />
  }
  if (vizType === 'scalar') {
    return <ScalarCard result={result as FlatResult} settings={settings} label={label} />
  }
  if (vizType === 'progress') {
    return <ProgressCard result={result as FlatResult} settings={settings} label={label} />
  }
  if (CHART_KEYS.has(vizType) && result.shape === 'flat') {
    const spec = buildChartSpec(result, vizType, settings)
    if (!spec) {
      return (
        <div className="grid h-full place-items-center text-xs text-slate-400 dark:text-slate-500">
          Nothing to chart.
        </div>
      )
    }
    // buildChartSpec collapses pie + donut to kind 'pie'; carry which one here.
    return <VizChart spec={spec} donut={vizType === 'donut'} />
  }

  return (
    <div className="grid h-full place-items-center text-xs text-slate-400 dark:text-slate-500">
      Unsupported visualization.
    </div>
  )
}
