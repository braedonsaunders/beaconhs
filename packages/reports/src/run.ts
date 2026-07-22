// The single report dispatcher. Every consumer — web viewer, CSV/XLSX export
// routes, builder preview, worker PDF runs — calls runReport with a
// tenant-scoped transaction. queryKind routes to a built-in; 'custom_query'
// routes to the whitelisted custom executor.

import type { Database } from '@beaconhs/db'
import type { ReportCustomQuery, ReportRule, ReportRuleGroup } from '@beaconhs/db/schema'
import type { ReportEntity } from './entities'
import {
  queryComplianceByEntity,
  queryComplianceByPerson,
  queryCorrectiveActionsList,
  queryCorrectiveActionsOpen,
  queryDocumentComplianceSnapshot,
  queryDocumentsOverdueReview,
  queryHazidSignatures,
  queryIncidentsSummary,
  queryIncidentsTrend12m,
  queryInspectionsCompleted,
  queryLoneWorkerSummary,
  queryOsha300Log,
  queryOverdueRollup,
  querySafetyKpiSummary,
  querySiteScorecard,
  querySkillsAssignments,
  querySkillsMissing,
  queryPpeReport,
  queryTrainingComplianceSnapshot,
  queryTrainingCredentialReport,
  queryTrainingExpiring,
} from './built-ins'
import { isTrainingReportQueryKind } from './training-filters'
import {
  isOperationalFilterReportSlug,
  normalizeOperationalReportFilters,
  operationalReportFiltersToRecord,
} from './operational-filters'
import { runCustomQuery } from './custom-query'
import { isoDate, type ReportRange, type ReportRunResult } from './types'

export type RunReportInput = {
  queryKind: string
  definitionSlug?: string
  filters: Record<string, unknown>
  range: ReportRange
  customQuery?: ReportCustomQuery | null
  /** Viewer/preview cap; scheduled runs leave it unset. */
  maxRows?: number
  /** Permission-filtered entity whitelist injected by the caller. Required for
   *  custom queries; built-in query kinds do not use it. */
  entityMap?: Record<string, ReportEntity>
}

export async function runReport(tx: Database, input: RunReportInput): Promise<ReportRunResult> {
  const { queryKind, range, customQuery } = input
  const filters =
    input.definitionSlug && isOperationalFilterReportSlug(input.definitionSlug)
      ? operationalReportFiltersToRecord(
          input.definitionSlug,
          normalizeOperationalReportFilters(input.definitionSlug, input.filters),
        )
      : input.filters
  if (isTrainingReportQueryKind(queryKind)) {
    return queryTrainingCredentialReport(tx, filters, queryKind, input.maxRows)
  }
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
    case 'compliance_by_entity':
      return queryComplianceByEntity(tx, filters)
    case 'compliance_by_person':
      return queryComplianceByPerson(tx, filters)
    case 'skills_missing':
      return querySkillsMissing(tx, filters)
    case 'skills_matrix':
      return querySkillsAssignments(tx, filters, 'skills_matrix')
    case 'skills_expired_upcoming':
      return querySkillsAssignments(tx, filters, 'skills_expired_upcoming')
    case 'skills_cwb':
      return querySkillsAssignments(tx, filters, 'skills_cwb')
    case 'corrective_actions_list':
      return queryCorrectiveActionsList(tx, filters)
    case 'ppe_list':
      return queryPpeReport(tx, filters, 'ppe_list')
    case 'ppe_expired_upcoming':
      return queryPpeReport(tx, filters, 'ppe_expired_upcoming')
    case 'hazid_signatures':
      return queryHazidSignatures(tx, filters)
    case 'incidents_trend_12m':
      return queryIncidentsTrend12m(tx, filters)
    case 'osha_300_log':
      return queryOsha300Log(tx, filters, range)
    case 'custom_query': {
      if (!input.entityMap) throw new Error('Custom query requires an authorized entity map')
      return runCustomQuery(tx, applyRuntimeCustomFilters(customQuery ?? null, filters), {
        maxRows: input.maxRows,
        entityMap: input.entityMap,
      })
    }
    default:
      throw new Error(`Unknown queryKind: ${queryKind}`)
  }
}

function applyRuntimeCustomFilters(
  customQuery: ReportCustomQuery | null,
  filters: Record<string, unknown>,
): ReportCustomQuery | null {
  if (!customQuery) return null
  const rules: Array<ReportRule | ReportRuleGroup> = []
  const statuses = Array.isArray(filters.statuses)
    ? filters.statuses.filter((value): value is string => typeof value === 'string' && value !== '')
    : []
  if (statuses.length > 0 && customQuery.entity === 'corrective_actions') {
    rules.push({ field: 'status', op: 'in', value: statuses })
  }
  if (
    customQuery.entity === 'skill_assignments' &&
    typeof filters.cwbStandard === 'string' &&
    filters.cwbStandard.trim()
  ) {
    rules.push({ field: 'cwb_standard', op: 'eq', value: filters.cwbStandard.trim() })
  }
  if (rules.length === 0) return customQuery
  return {
    ...customQuery,
    filters: {
      combinator: 'and',
      rules: [...(customQuery.filters ? [customQuery.filters] : []), ...rules],
    },
  }
}

// --- Date-range resolution ---------------------------------------------------

/** Which range semantics a queryKind uses — drives both the range computation
 *  and whether the viewer offers a range picker at all. */
export function rangeModeFor(queryKind: string): 'lookback' | 'lookahead' | 'as_of' {
  if (queryKind === 'training_expiring') return 'lookahead'
  if (
    isTrainingReportQueryKind(queryKind) ||
    queryKind === 'documents_overdue_review' ||
    queryKind === 'corrective_actions_open' ||
    queryKind === 'overdue_rollup' ||
    queryKind === 'training_compliance_snapshot' ||
    queryKind === 'document_compliance_snapshot' ||
    queryKind === 'compliance_by_entity' ||
    queryKind === 'compliance_by_person' ||
    queryKind === 'skills_missing' ||
    queryKind === 'skills_matrix' ||
    queryKind === 'skills_expired_upcoming' ||
    queryKind === 'skills_cwb' ||
    queryKind === 'corrective_actions_list' ||
    queryKind === 'ppe_list' ||
    queryKind === 'ppe_expired_upcoming' ||
    queryKind === 'hazid_signatures' ||
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
    case 'osha_300_log':
      // OSHA 300/300A logs are filed per calendar year — default to a rolling
      // 12-month window; the viewer's range picker can narrow it.
      return 365
    case 'lone_worker_summary':
      return 7
    default:
      return 7
  }
}
