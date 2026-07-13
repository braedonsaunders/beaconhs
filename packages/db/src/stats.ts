// Planner statistics tuning for the shared-schema multi-tenant model.
//
// In a single shared schema, pg_statistic is aggregated across ALL tenants per
// column. When one tenant's row count dwarfs another's (the "noisy neighbour"
// skew), the planner mis-estimates per-tenant selectivity and can pick poor
// plans. Raising the statistics target on tenant_id (and the hottest filter
// columns) for the high-volume tables gives the planner a finer-grained
// histogram, so tenant-scoped row estimates stay accurate as the tenant count
// grows. This is the proportionate mitigation pre-launch; if skew still bites at
// scale, LIST-partitioning the worst offenders by tenant gives per-partition
// statistics (the heavyweight escalation).
//
// Applied idempotently by migrate.ts after RLS, then ANALYZE refreshes the
// affected tables so the new targets take effect immediately. Time-series tables
// that Phase 5 RANGE-partitions by month additionally get per-partition stats
// for free.

// High-volume, tenant-scoped tables whose tenant_id histogram benefits most.
export const STATS_HIGH_VOLUME_TABLES = [
  'audit_log',
  'form_responses',
  'form_response_steps',
  'incidents',
  'journal_entries',
  'inspection_records',
  'inspection_record_criteria',
  'equipment_inspection_records',
  'equipment_inspection_record_criteria',
  'hazid_assessments',
  'hazid_assessment_hazards',
  'hazid_assessment_signatures',
  'hazid_assessment_questions',
  'training_records',
  'compliance_status',
  'compliance_dispatches',
  'kiosk_scans',
  'notifications',
  'email_log',
  'sms_log',
  'corrective_actions',
  'attachments',
  'people',
  'equipment_items',
  'ppe_items',
  'document_acknowledgments',
  'domain_event_outbox',
] as const

// Hot non-tenant filter columns worth a finer histogram (status enums, etc.).
const EXTRA_STAT_COLUMNS: Record<string, string[]> = {
  form_responses: ['status'],
  incidents: ['status'],
  corrective_actions: ['status'],
  inspection_records: ['status'],
  compliance_status: ['status'],
}

// One ALTER per (table, column). migrate.ts applies the complete set
// transactionally after schema migrations; a missing table/column is schema
// drift and fails the deploy instead of silently skipping the target.
export const STATS_SQL: string[] = [
  ...STATS_HIGH_VOLUME_TABLES.map(
    (t) => `ALTER TABLE ${t} ALTER COLUMN tenant_id SET STATISTICS 1000;`,
  ),
  ...Object.entries(EXTRA_STAT_COLUMNS).flatMap(([t, cols]) =>
    cols.map((c) => `ALTER TABLE ${t} ALTER COLUMN ${c} SET STATISTICS 500;`),
  ),
]
