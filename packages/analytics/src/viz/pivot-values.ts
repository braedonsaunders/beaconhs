import type { PivotAxisKey, PivotCell, PivotResult, ResultColumn } from '../result'
import { RAG_DISCRETE, type CfRule } from './conditional-format'
import type { VizSettings } from './registry'

/** A display measure can differ from the measure used for cell colors. */
export function pivotDisplayValue(
  cell: PivotCell | null,
  valueKey: string,
  settings: VizSettings,
): unknown {
  const status = cell?.[valueKey]
  if (typeof settings.displayValueField !== 'string') return status
  if (status === null || status === undefined || status === 'missing') return null
  const display = cell?.[settings.displayValueField]
  if (display !== null && display !== undefined && display !== '') return display
  if (status === 'valid' || status === 'no_expiry') return settings.noExpiryLabel ?? status
  return status
}

/** Axis IDs distinguish duplicate names without appearing in the heading. */
export function pivotAxisLabel(
  axis: PivotAxisKey,
  dimensions: ResultColumn[],
  labelField: unknown,
): string {
  const index =
    typeof labelField === 'string' ? dimensions.findIndex((d) => d.key === labelField) : -1
  return index >= 0 ? (axis.labels[index] ?? '') : axis.labels.join(' · ')
}

/** Resolve conditional-formatting rules for a pivot measure, defaulting string
 *  measures (such as `coverage_status`) to the training-matrix RAG palette. */
export function pivotConditionalRules(
  value: Pick<ResultColumn, 'key' | 'dataType'> | null | undefined,
  settings: VizSettings,
): CfRule[] {
  const configured = settings.conditionalFormats as CfRule[] | undefined
  if (configured?.length) return configured
  return value?.dataType === 'string'
    ? [{ type: 'discrete', column: value.key, map: RAG_DISCRETE }]
    : []
}

/** For a heatmap, derive a numeric color-scale across the value measure when the
 *  user hasn't configured one. */
export function heatmapPivotSettings(result: PivotResult, settings: VizSettings): VizSettings {
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
