// The single report dispatcher. Every consumer — web viewer, CSV/XLSX export
// routes, builder preview, worker PDF runs — calls runReport with a
// tenant-scoped transaction. queryKind routes to a built-in; 'custom_query'
// routes to the whitelisted custom executor.

import type { Database } from '@beaconhs/db'
import type { ReportCustomQuery } from '@beaconhs/db/schema'
import {
  queryCorrectiveActionsOpen,
  queryDocumentComplianceSnapshot,
  queryDocumentsOverdueReview,
  queryIncidentsSummary,
  queryIncidentsTrend12m,
  queryInspectionsCompleted,
  queryLoneWorkerSummary,
  queryOverdueRollup,
  querySafetyKpiSummary,
  querySiteScorecard,
  queryTrainingComplianceSnapshot,
  queryTrainingExpiring,
} from './built-ins'
import { runCustomQuery } from './custom-query'
import { isoDate, type ReportRange, type ReportRunResult } from './types'

export type RunReportInput = {
  queryKind: string
  filters: Record<string, unknown>
  range: ReportRange
  customQuery?: ReportCustomQuery | null
  /** Viewer/preview cap; scheduled runs leave it unset. Custom queries only. */
  maxRows?: number
}

export async function runReport(tx: Database, input: RunReportInput): Promise<ReportRunResult> {
  const { queryKind, filters, range, customQuery } = input
  switch (queryKind) {
    case 'incidents_summary':
      return queryIncidentsSummary(tx, filters, range)
    case 'training_expiring':
      return queryTrainingExpiring(tx, filters, range)
    case 'corrective_actions_open':
      return queryCorrectiveActionsOpen(tx, filters)
    case 'inspections_completed':
      return queryInspectionsCompleted(tx, filters, range)
    case 'documents_overdue_review':
      return queryDocumentsOverdueReview(tx, filters)
    case 'safety_kpi_summary':
      return querySafetyKpiSummary(tx, filters, range)
    case 'site_scorecard':
      return querySiteScorecard(tx, filters, range)
    case 'overdue_rollup':
      return queryOverdueRollup(tx, filters)
    case 'lone_worker_summary':
      return queryLoneWorkerSummary(tx, filters, range)
    case 'training_compliance_snapshot':
      return queryTrainingComplianceSnapshot(tx, filters)
    case 'document_compliance_snapshot':
      return queryDocumentComplianceSnapshot(tx, filters)
    case 'incidents_trend_12m':
      return queryIncidentsTrend12m(tx, filters)
    case 'custom_query':
      return runCustomQuery(tx, customQuery ?? null, { maxRows: input.maxRows })
    default:
      throw new Error(`Unknown queryKind: ${queryKind}`)
  }
}

// --- Date-range resolution ---------------------------------------------------

/** Which range semantics a queryKind uses — drives both the range computation
 *  and whether the viewer offers a range picker at all. */
export function rangeModeFor(queryKind: string): 'lookback' | 'lookahead' | 'as_of' {
  if (queryKind === 'training_expiring') return 'lookahead'
  if (
    queryKind === 'documents_overdue_review' ||
    queryKind === 'corrective_actions_open' ||
    queryKind === 'overdue_rollup' ||
    queryKind === 'training_compliance_snapshot' ||
    queryKind === 'document_compliance_snapshot' ||
    queryKind === 'incidents_trend_12m' ||
    queryKind === 'custom_query'
  ) {
    return 'as_of'
  }
  return 'lookback'
}

export function computeRangeFor(queryKind: string, filters: Record<string, unknown>): ReportRange {
  const now = new Date()
  const f = filters as { days?: number; rangeDays?: number; lookaheadDays?: number }
  const mode = rangeModeFor(queryKind)

  if (mode === 'lookback') {
    const lookback = f.rangeDays ?? f.days ?? defaultLookbackDays(queryKind)
    const from = new Date(now.getTime() - lookback * 24 * 3600 * 1000)
    return { from, to: now, label: `${isoDate(from)} → ${isoDate(now)} (last ${lookback} days)` }
  }
  if (mode === 'lookahead') {
    const lookahead = f.lookaheadDays ?? f.days ?? 30
    const to = new Date(now.getTime() + lookahead * 24 * 3600 * 1000)
    return { from: now, to, label: `${isoDate(now)} → ${isoDate(to)} (next ${lookahead} days)` }
  }
  return { from: new Date(0), to: now, label: `As of ${isoDate(now)}` }
}

function defaultLookbackDays(queryKind: string): number {
  switch (queryKind) {
    case 'incidents_summary':
      return 7
    case 'inspections_completed':
      return 7
    case 'safety_kpi_summary':
      return 30
    case 'site_scorecard':
      return 30
    case 'lone_worker_summary':
      return 7
    default:
      return 7
  }
}
