import type { PivotAxisKey, PivotCell, ResultColumn } from '../result'
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
