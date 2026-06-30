// In-app report execution. Runs the shared engine under the caller's
// tenant-scoped RLS context (ctx.db) — the same code path the worker uses for
// scheduled PDFs, so what you see in the viewer is exactly what subscribers
// get emailed.

import {
  augmentEntityMapWithCustomFields,
  computeRangeFor,
  rangeModeFor,
  runReport,
  type ReportRunResult,
} from '@beaconhs/reports'
import { discoverEntityMap } from '@beaconhs/analytics/server'
import type { RequestContext } from '@beaconhs/tenant'
import type { ReportDefinitionRow } from './_definitions'

export type ViewerRun = {
  result: ReportRunResult
  rangeLabel: string
  rangeMode: 'lookback' | 'lookahead' | 'as_of'
  /** The days value the range was computed with (null when not applicable). */
  days: number | null
  error: string | null
}

export const VIEWER_RANGE_CHOICES = [7, 14, 30, 90, 365]

/** Viewer cap on custom-query rows; exports run uncapped (to the plan limit).
 *  Tables paginate client-side, so a larger cap is cheap to browse in-app. */
const VIEWER_MAX_ROWS = 2000

export async function runReportForViewer(
  ctx: RequestContext,
  definition: ReportDefinitionRow,
  opts: { days?: number | null; maxRows?: number } = {},
): Promise<ViewerRun> {
  const mode = rangeModeFor(definition.queryKind)
  const days =
    mode === 'as_of'
      ? null
      : opts.days && VIEWER_RANGE_CHOICES.includes(opts.days)
        ? opts.days
        : null
  const filters: Record<string, unknown> = days ? { days } : {}
  const range = computeRangeFor(definition.queryKind, filters)

  try {
    const result = await ctx.db(async (tx) =>
      runReport(tx, {
        queryKind: definition.queryKind,
        filters,
        range,
        customQuery: definition.customQuery,
        maxRows: opts.maxRows ?? VIEWER_MAX_ROWS,
        entityMap: await augmentEntityMapWithCustomFields(tx, discoverEntityMap()),
      }),
    )
    return { result, rangeLabel: range.label, rangeMode: mode, days, error: null }
  } catch (err) {
    return {
      result: { groups: [], summary: [], charts: [], rowCount: 0 },
      rangeLabel: range.label,
      rangeMode: mode,
      days,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
