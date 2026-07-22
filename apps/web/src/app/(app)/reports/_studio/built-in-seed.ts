// Clone-on-edit seeds. Built-in reports are code-defined (no customQuery), so
// editing one opens a tenant-owned COPY in the builder pre-filled from this map.
// Single-source built-ins reproduce faithfully; the few cross-module rollups
// (KPI summary, scorecard, overdue rollup, OSHA log) fall back to a best-effort
// starter on the closest entity — the original built-in keeps running as-is.
//
// Entity + column keys are the DISCOVERED catalog's physical names.

import type { ReportCustomQuery } from '@beaconhs/db/schema'

const TRAINING_MATRIX_SEED: ReportCustomQuery = {
  entity: 'training_matrix',
  mode: 'rows',
  columns: [
    'person_name',
    'employee_no',
    'course_name',
    'completed_on',
    'expires_on',
    'coverage_status',
  ],
  groupBy: 'course_name',
  sort: { column: 'person_name', direction: 'asc' },
}

const SEEDS: Record<string, ReportCustomQuery> = {
  incidents_summary: {
    entity: 'incidents',
    mode: 'rows',
    columns: ['reference', 'title', 'severity', 'status', 'type', 'occurred_at'],
    groupBy: 'severity',
    sort: { column: 'occurred_at', direction: 'desc' },
  },
  incidents_trend_12m: {
    entity: 'incidents',
    mode: 'summarize',
    columns: [],
    breakouts: [{ column: 'occurred_at', bin: 'month' }, { column: 'severity' }],
    measures: [{ fn: 'count' }],
  },
  safety_kpi_summary: {
    entity: 'incidents',
    mode: 'summarize',
    columns: [],
    breakouts: [{ column: 'severity' }],
    measures: [{ fn: 'count' }],
  },
  site_scorecard: {
    entity: 'incidents',
    mode: 'summarize',
    columns: [],
    breakouts: [{ column: 'site_org_unit_id' }],
    measures: [{ fn: 'count' }],
  },
  osha_300_log: {
    entity: 'incidents',
    mode: 'rows',
    columns: ['reference', 'occurred_at', 'severity', 'status', 'title'],
    sort: { column: 'occurred_at', direction: 'asc' },
  },
  corrective_actions_open: {
    entity: 'corrective_actions',
    mode: 'rows',
    columns: ['reference', 'title', 'severity', 'status', 'due_on'],
    groupBy: 'status',
    sort: { column: 'due_on', direction: 'asc' },
    filters: {
      combinator: 'and',
      rules: [
        { field: 'status', op: 'in', value: ['open', 'in_progress', 'pending_verification'] },
      ],
    },
  },
  overdue_rollup: {
    entity: 'corrective_actions',
    mode: 'rows',
    columns: ['reference', 'title', 'severity', 'due_on'],
    sort: { column: 'due_on', direction: 'asc' },
  },
  documents_overdue_review: {
    entity: 'documents',
    mode: 'rows',
    columns: ['key', 'title', 'category', 'status', 'next_review_on'],
    groupBy: 'category',
    sort: { column: 'next_review_on', direction: 'asc' },
  },
  document_compliance_snapshot: {
    entity: 'documents',
    mode: 'rows',
    columns: ['key', 'title', 'status', 'next_review_on'],
    sort: { column: 'title', direction: 'asc' },
  },
  training_expiring: {
    entity: 'training_matrix',
    mode: 'rows',
    columns: ['person_name', 'course_name', 'completed_on', 'expires_on', 'coverage_status'],
    sort: { column: 'expires_on', direction: 'asc' },
  },
  training_certificates: TRAINING_MATRIX_SEED,
  training_expired_upcoming: TRAINING_MATRIX_SEED,
  training_missing: TRAINING_MATRIX_SEED,
  inspections_completed: {
    entity: 'inspection_records',
    mode: 'rows',
    columns: ['reference', 'status', 'occurred_at', 'site_org_unit_id'],
    sort: { column: 'occurred_at', direction: 'desc' },
  },
  lone_worker_summary: {
    entity: 'form_responses',
    mode: 'rows',
    columns: ['status', 'submitted_at', 'site_org_unit_id'],
    sort: { column: 'submitted_at', direction: 'desc' },
  },
}

/** A starter custom query for editing a copy of a built-in report, or null when
 *  there's no sensible single-source mapping (the builder then starts blank). */
export function builtInSeedQuery(queryKind: string): ReportCustomQuery | null {
  return SEEDS[queryKind] ?? null
}
