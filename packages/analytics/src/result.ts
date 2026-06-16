// The canonical result contract the compiler fills and every visualization
// consumes. Two shapes: a flat typed-rows table, and a pivot matrix. Both must
// be JSON-serializable end-to-end (server action → client renderer), so: plain
// objects/arrays only, no Map/Date instances on the wire (dates are ISO strings,
// numbers stay numbers).

import type { BhqlBin } from '@beaconhs/db/schema'
import type { SemanticType } from './semantic'

export type ResultDataType = 'string' | 'number' | 'date' | 'timestamp' | 'boolean'

/** A column in a result, with the metadata the viz layer needs to format it. */
export type ResultColumn = {
  /** Output key: a breakout/measure alias, or an entity column key (raw mode). */
  key: string
  label: string
  role: 'dimension' | 'measure'
  semanticType: SemanticType
  dataType: ResultDataType
  /** Echoed bin (if the dimension was bucketed) so the viz can label buckets. */
  bin?: BhqlBin
}

export type FlatResult = {
  shape: 'flat'
  columns: ResultColumn[]
  /** Rows keyed by `column.key`, with typed values (numbers/strings/ISO dates). */
  rows: Record<string, unknown>[]
  rowCount: number
  /** True when the row cap was hit (renderer shows a "showing N" note). */
  truncated: boolean
}

/** One position on a pivot axis: the tuple of dimension values + display labels,
 *  one entry per row/column dimension. */
export type PivotAxisKey = {
  values: unknown[]
  labels: string[]
}

/** A pivot cell: measure alias → value. */
export type PivotCell = Record<string, unknown>

export type PivotResult = {
  shape: 'pivot'
  rowDimensions: ResultColumn[]
  columnDimensions: ResultColumn[]
  valueMeasures: ResultColumn[]
  /** Ordered distinct row tuples. */
  rowKeys: PivotAxisKey[]
  /** Ordered distinct column tuples. */
  columnKeys: PivotAxisKey[]
  /** Dense matrix: cells[rowIdx][colIdx]; null = no data for that combination. */
  cells: (PivotCell | null)[][]
  rowCount: number
  truncated: boolean
}

export type BhqlResult = FlatResult | PivotResult

/** The shape a query produced — used by the viz layer to auto-pick a default. */
export type ResultShape = 'scalar' | 'rows' | 'pivot'

/** Classify a result for auto-viz: a single dimensionless measure row reads as a
 *  scalar/KPI; a pivot is a pivot; everything else is rows. */
export function resultShapeOf(result: BhqlResult): ResultShape {
  if (result.shape === 'pivot') return 'pivot'
  const measures = result.columns.filter((c) => c.role === 'measure')
  const dimensions = result.columns.filter((c) => c.role === 'dimension')
  if (dimensions.length === 0 && measures.length >= 1 && result.rows.length <= 1) return 'scalar'
  return 'rows'
}
