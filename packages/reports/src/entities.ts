// THE single source of truth for what a custom report can query. Each entity
// carries both the UI metadata (labels, kinds, descriptions — drives the
// report studio) and the SQL metadata (physical table, whitelisted column
// identifiers — drives the executor). This replaces the old pair of
// hand-synced copies (apps/web _builder-meta.ts + apps/worker
// reports-shared.ts whitelists).

import type { ReportFilterOperator, ReportRuleGroup } from '@beaconhs/db/schema'

export type ReportColumnKind = 'text' | 'date' | 'timestamp' | 'enum' | 'uuid' | 'number'

export type ReportEntityColumn = {
  /** Public key used in stored query plans (snake_case). */
  key: string
  label: string
  kind: ReportColumnKind
  /** Physical column name. Defaults to `key` when omitted. */
  sql?: string
  /**
   * Raw, already-table-qualified SQL expression used VERBATIM as the column
   * reference instead of `"table"."col"`. Server-generated only (never from
   * user input) — used for synthetic columns such as tenant custom fields
   * read out of a jsonb `metadata` column. When set, takes precedence over
   * `sql`/`key` everywhere a physical reference is built.
   */
  expr?: string
}

export type ReportEntity = {
  /** Entity key = the physical table/view name (validated against the registry). */
  key: string
  label: string
  category: string
  /** A line of helpful text shown under the entity name in the picker. */
  description: string
  /** Physical table (or RLS-safe view) name. */
  table: string
  /** Columns selectable for output AND filterable. Order is preserved. */
  columns: ReportEntityColumn[]
  defaultSort?: { column: string; direction: 'asc' | 'desc' }
  /**
   * The physical table carries a `deleted_at` soft-delete column. Executors
   * (reports + BHQL) implicitly add `deleted_at IS NULL` so soft-deleted rows
   * never surface — matching the module list pages and the report_* views.
   * Views bake the filter in themselves and leave this unset.
   */
  softDelete?: boolean
  /**
   * Implicit predicate ALWAYS AND-ed into every query against this entity.
   * Used by scoped virtual entities — e.g. a per-Builder-app
   * `form_responses:<templateId>` source is the real form_responses table
   * with a baked-in template_id filter (see @beaconhs/analytics/server
   * scopedFormAppEntity). Server-generated only, never from user input.
   */
  baseFilter?: ReportRuleGroup
}

export const REPORT_ENTITIES: ReportEntity[] = [
  {
    key: 'incidents',
    label: 'Incidents',
    category: 'incidents',
    description: 'Reported incidents (injury, near-miss, property, environmental, etc.)',
    table: 'incidents',
    softDelete: true,
    columns: [
      { key: 'reference', label: 'Reference', kind: 'text' },
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'severity', label: 'Severity', kind: 'enum' },
      { key: 'status', label: 'Status', kind: 'enum' },
      { key: 'type', label: 'Type', kind: 'enum' },
      { key: 'occurred_at', label: 'Occurred at', kind: 'timestamp' },
      { key: 'site_org_unit_id', label: 'Site (id)', kind: 'uuid' },
      { key: 'department_id', label: 'Department (id)', kind: 'uuid' },
      { key: 'actual_severity', label: 'Actual severity (1-5)', kind: 'number' },
      { key: 'potential_severity', label: 'Potential severity (1-5)', kind: 'number' },
    ],
    defaultSort: { column: 'occurred_at', direction: 'desc' },
  },
  {
    key: 'corrective_actions',
    label: 'Corrective actions',
    category: 'corrective_actions',
    description: 'CAs assigned from inspections, audits, incidents, observations, etc.',
    table: 'corrective_actions',
    softDelete: true,
    columns: [
      { key: 'reference', label: 'Reference', kind: 'text' },
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'severity', label: 'Severity', kind: 'enum' },
      { key: 'status', label: 'Status', kind: 'enum' },
      { key: 'due_on', label: 'Due on', kind: 'date' },
      { key: 'assigned_on', label: 'Assigned on', kind: 'date' },
      { key: 'source', label: 'Source', kind: 'enum' },
      { key: 'site_org_unit_id', label: 'Site (id)', kind: 'uuid' },
    ],
    defaultSort: { column: 'due_on', direction: 'asc' },
  },
  {
    key: 'training_records',
    label: 'Training records',
    category: 'training',
    description: 'Earned training certificates per person.',
    table: 'training_records',
    softDelete: true,
    columns: [
      { key: 'person_id', label: 'Person (id)', kind: 'uuid' },
      { key: 'course_id', label: 'Course (id)', kind: 'uuid' },
      { key: 'completed_on', label: 'Completed on', kind: 'date' },
      { key: 'expires_on', label: 'Expires on', kind: 'date' },
      { key: 'source', label: 'Source', kind: 'enum' },
      { key: 'score', label: 'Score', kind: 'number' },
      { key: 'grade', label: 'Grade (%)', kind: 'number' },
    ],
    defaultSort: { column: 'completed_on', direction: 'desc' },
  },
  {
    key: 'skill_assignments',
    label: 'Skills & certifications',
    category: 'training',
    description:
      'Externally-issued skills and certifications per person — authority, code, granted and expiry dates (e.g. CWB welder rosters).',
    // Join-baked view (packages/db/src/views.ts) — RLS flows through from base tables.
    table: 'report_skill_assignments',
    columns: [
      { key: 'employee_no', label: 'Employee #', kind: 'text' },
      { key: 'last_name', label: 'Last name', kind: 'text' },
      { key: 'first_name', label: 'First name', kind: 'text' },
      { key: 'trade', label: 'Trade', kind: 'text' },
      { key: 'authority', label: 'Authority', kind: 'text' },
      { key: 'certification_code', label: 'Certification code', kind: 'text' },
      { key: 'certification_name', label: 'Certification name', kind: 'text' },
      { key: 'granted_on', label: 'Granted on', kind: 'date' },
      { key: 'expires_on', label: 'Expires on', kind: 'date' },
      { key: 'status', label: 'Status', kind: 'enum' },
    ],
    defaultSort: { column: 'expires_on', direction: 'asc' },
  },
  {
    key: 'inspection_records',
    label: 'Inspection records',
    category: 'inspections',
    description: 'Inspection records performed against an inspection_type.',
    table: 'inspection_records',
    softDelete: true,
    columns: [
      { key: 'reference', label: 'Reference', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'enum' },
      { key: 'occurred_at', label: 'Occurred at', kind: 'timestamp' },
      { key: 'type_id', label: 'Type (id)', kind: 'uuid' },
      { key: 'site_org_unit_id', label: 'Site (id)', kind: 'uuid' },
    ],
    defaultSort: { column: 'occurred_at', direction: 'desc' },
  },
  {
    key: 'documents',
    label: 'Documents',
    category: 'documents',
    description: 'Controlled documents in the document library.',
    table: 'documents',
    softDelete: true,
    columns: [
      { key: 'key', label: 'Document key', kind: 'text' },
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'enum' },
      { key: 'next_review_on', label: 'Next review on', kind: 'date' },
    ],
    defaultSort: { column: 'next_review_on', direction: 'asc' },
  },
  {
    key: 'equipment_items',
    label: 'Equipment',
    category: 'equipment',
    description: 'Equipment items in the fleet.',
    table: 'equipment_items',
    softDelete: true,
    columns: [
      { key: 'asset_tag', label: 'Asset tag', kind: 'text' },
      { key: 'name', label: 'Name', kind: 'text' },
      { key: 'serial_number', label: 'Serial number', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'enum' },
      { key: 'current_site_org_unit_id', label: 'Current site (id)', kind: 'uuid' },
      { key: 'manufacturer', label: 'Manufacturer', kind: 'text' },
      { key: 'model', label: 'Model', kind: 'text' },
      { key: 'purchase_price', label: 'Purchase price', kind: 'number' },
      { key: 'next_oil_change_due', label: 'Next oil change', kind: 'date' },
    ],
    defaultSort: { column: 'asset_tag', direction: 'asc' },
  },
  {
    key: 'equipment_fleet',
    label: 'Equipment fleet',
    category: 'equipment',
    description:
      'One row per asset with type, current site/holder, and YTD + all-time usage (hours/km). Operational only — equipment financials live in the admin app. Drives the fleet and upcoming inspection/oil-change reports.',
    // Join-baked view (packages/db/src/views.ts) — RLS flows through base tables.
    table: 'report_equipment_fleet',
    columns: [
      { key: 'asset_tag', label: 'Asset tag', kind: 'text' },
      { key: 'name', label: 'Name', kind: 'text' },
      { key: 'serial_number', label: 'Serial number', kind: 'text' },
      { key: 'equipment_type', label: 'Type', kind: 'text' },
      { key: 'type_category', label: 'Category', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'enum' },
      { key: 'site_name', label: 'Current site', kind: 'text' },
      { key: 'holder_name', label: 'Holder', kind: 'text' },
      { key: 'is_missing', label: 'Missing', kind: 'enum' },
      { key: 'manufacturer', label: 'Manufacturer', kind: 'text' },
      { key: 'model', label: 'Model', kind: 'text' },
      { key: 'purchase_price', label: 'Purchase price', kind: 'number' },
      { key: 'ownership', label: 'Ownership', kind: 'enum' },
      { key: 'last_inspection_on', label: 'Last inspection', kind: 'date' },
      { key: 'next_inspection_due', label: 'Next inspection due', kind: 'date' },
      { key: 'requires_oil_change', label: 'Requires oil change', kind: 'enum' },
      { key: 'last_oil_change_on', label: 'Last oil change', kind: 'date' },
      { key: 'next_oil_change_due', label: 'Next oil change', kind: 'date' },
      { key: 'oil_change_interval_months', label: 'Oil change interval (mo.)', kind: 'number' },
      { key: 'purchase_date', label: 'Purchase date', kind: 'date' },
      { key: 'hours_ytd', label: 'Hours YTD', kind: 'number' },
      { key: 'km_ytd', label: 'Km YTD', kind: 'number' },
      { key: 'hours_total', label: 'Hours (all-time)', kind: 'number' },
      { key: 'current_site_org_unit_id', label: 'Current site (id)', kind: 'uuid' },
    ],
    defaultSort: { column: 'asset_tag', direction: 'asc' },
  },
  {
    key: 'vehicle_log_entries',
    label: 'Vehicle log entries',
    category: 'equipment',
    description:
      'Daily vehicle log detail with driver, vehicle, site, km, hours and source/import status.',
    table: 'report_vehicle_log_entries',
    columns: [
      { key: 'entry_date', label: 'Entry date', kind: 'date' },
      { key: 'month', label: 'Month', kind: 'date' },
      { key: 'asset_tag', label: 'Asset tag', kind: 'text' },
      { key: 'vehicle_name', label: 'Vehicle', kind: 'text' },
      { key: 'employee_no', label: 'Employee #', kind: 'text' },
      { key: 'driver_name', label: 'Driver', kind: 'text' },
      { key: 'entry_mode', label: 'Mode', kind: 'enum' },
      { key: 'start_odometer', label: 'Start odometer', kind: 'number' },
      { key: 'end_odometer', label: 'End odometer', kind: 'number' },
      { key: 'business_km', label: 'Business km', kind: 'number' },
      { key: 'personal_km', label: 'Personal km', kind: 'number' },
      { key: 'total_km', label: 'Total km', kind: 'number' },
      { key: 'hours_on_site', label: 'Hours on site', kind: 'number' },
      { key: 'manpower_count', label: 'Crew count', kind: 'number' },
      { key: 'site_code', label: 'Site code', kind: 'text' },
      { key: 'site_name', label: 'Site', kind: 'text' },
      { key: 'destination', label: 'Destination', kind: 'text' },
      { key: 'import_status', label: 'Import status', kind: 'enum' },
      { key: 'source_system', label: 'Source system', kind: 'text' },
      { key: 'source_name', label: 'Source name', kind: 'text' },
      { key: 'source_label', label: 'Source label', kind: 'text' },
      { key: 'driver_person_id', label: 'Driver (id)', kind: 'uuid' },
      { key: 'equipment_item_id', label: 'Vehicle (id)', kind: 'uuid' },
      { key: 'site_org_unit_id', label: 'Site (id)', kind: 'uuid' },
    ],
    defaultSort: { column: 'entry_date', direction: 'desc' },
  },
  {
    key: 'vehicle_log_monthly',
    label: 'Vehicle log monthly',
    category: 'equipment',
    description:
      'Monthly driver-by-vehicle rollup for vehicle-log summaries, utilization and import coverage.',
    table: 'report_vehicle_log_monthly',
    columns: [
      { key: 'month', label: 'Month', kind: 'date' },
      { key: 'asset_tag', label: 'Asset tag', kind: 'text' },
      { key: 'vehicle_name', label: 'Vehicle', kind: 'text' },
      { key: 'employee_no', label: 'Employee #', kind: 'text' },
      { key: 'driver_name', label: 'Driver', kind: 'text' },
      { key: 'logged_days', label: 'Logged days', kind: 'number' },
      { key: 'km_days', label: 'Days with km', kind: 'number' },
      { key: 'business_km', label: 'Business km', kind: 'number' },
      { key: 'personal_km', label: 'Personal km', kind: 'number' },
      { key: 'total_km', label: 'Total km', kind: 'number' },
      { key: 'hours_on_site', label: 'Hours on site', kind: 'number' },
      { key: 'manpower_count', label: 'Crew count total', kind: 'number' },
      { key: 'imported_days', label: 'Imported days', kind: 'number' },
      { key: 'manual_days', label: 'Manual days', kind: 'number' },
      { key: 'first_odometer', label: 'First odometer', kind: 'number' },
      { key: 'last_odometer', label: 'Last odometer', kind: 'number' },
      { key: 'site_count', label: 'Sites', kind: 'number' },
      { key: 'driver_person_id', label: 'Driver (id)', kind: 'uuid' },
      { key: 'equipment_item_id', label: 'Vehicle (id)', kind: 'uuid' },
    ],
    defaultSort: { column: 'month', direction: 'desc' },
  },
  {
    key: 'ppe_items',
    label: 'PPE items',
    category: 'ppe',
    description: 'Individual PPE assets.',
    table: 'ppe_items',
    softDelete: true,
    columns: [
      { key: 'serial_number', label: 'Serial', kind: 'text' },
      { key: 'size', label: 'Size', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'enum' },
      { key: 'current_holder_person_id', label: 'Current holder (id)', kind: 'uuid' },
      { key: 'last_inspection_on', label: 'Last pre-use inspection', kind: 'date' },
      { key: 'next_inspection_due', label: 'Next pre-use inspection', kind: 'date' },
      { key: 'next_annual_inspection_due', label: 'Next annual inspection', kind: 'date' },
      { key: 'purchase_date', label: 'Purchase date', kind: 'date' },
      { key: 'expires_on', label: 'Expires on', kind: 'date' },
    ],
    defaultSort: { column: 'next_inspection_due', direction: 'asc' },
  },
  {
    key: 'training_matrix',
    label: 'Training matrix',
    category: 'training',
    description:
      'Person × course coverage — one row per active person and course with the latest record status (valid / expiring / expired / missing).',
    // Join-baked view (packages/db/src/views.ts) — RLS flows through base tables.
    table: 'report_training_matrix',
    columns: [
      { key: 'employee_no', label: 'Employee #', kind: 'text' },
      { key: 'last_name', label: 'Last name', kind: 'text' },
      { key: 'first_name', label: 'First name', kind: 'text' },
      { key: 'person_name', label: 'Person', kind: 'text' },
      { key: 'course_code', label: 'Course code', kind: 'text' },
      { key: 'course_name', label: 'Course', kind: 'text' },
      { key: 'completed_on', label: 'Completed on', kind: 'date' },
      { key: 'expires_on', label: 'Expires on', kind: 'date' },
      { key: 'coverage_status', label: 'Coverage', kind: 'enum' },
    ],
    defaultSort: { column: 'person_name', direction: 'asc' },
  },
  {
    key: 'incident_rates',
    label: 'Incident rates (TRIR / DART)',
    category: 'incidents',
    description:
      'Per-month recordable + DART incident counts and hours worked. Build TRIR/DART as a calculated rate: sum(recordable) ÷ sum(hours) × 200,000.',
    table: 'report_incident_rates',
    columns: [
      { key: 'month', label: 'Month', kind: 'date' },
      { key: 'recordable_count', label: 'Recordable incidents', kind: 'number' },
      { key: 'dart_count', label: 'DART incidents', kind: 'number' },
      { key: 'hours_worked', label: 'Hours worked', kind: 'number' },
    ],
    defaultSort: { column: 'month', direction: 'asc' },
  },
]

export const REPORT_ENTITY_MAP: Record<string, ReportEntity> = Object.fromEntries(
  REPORT_ENTITIES.map((e) => [e.key, e]),
)

export function entityColumn(entity: ReportEntity, key: string): ReportEntityColumn | null {
  return entity.columns.find((c) => c.key === key) ?? null
}

/** Physical (quoted-safe) column identifier for a whitelisted column key. */
export function entityColumnSql(entity: ReportEntity, key: string): string | null {
  const col = entityColumn(entity, key)
  return col ? (col.sql ?? col.key) : null
}

/**
 * The full SQL reference for a whitelisted column — either its server-generated
 * `expr` (used verbatim) or the default `"table"."col"`. This is the single
 * place every executor (reports, BHQL, the public API) must build a column
 * reference, so synthetic expression columns (custom fields) work everywhere
 * without weakening the injection guarantee: `expr` is only ever set by trusted
 * server code, and physical identifiers still come from the whitelist.
 */
export function columnRef(entity: ReportEntity, key: string): string | null {
  const col = entityColumn(entity, key)
  if (!col) return null
  if (col.expr) return col.expr
  return `"${entity.table}"."${col.sql ?? col.key}"`
}

// --- Operators --------------------------------------------------------------

export type ReportOperatorMeta = {
  key: ReportFilterOperator
  label: string
  /** Whether this op needs a value field next to it. */
  needsValue: 'none' | 'one' | 'list'
  /** Restrict to specific column kinds (undefined = applies to all). */
  applicableKinds?: ReportColumnKind[]
}

export const REPORT_OPERATORS: ReportOperatorMeta[] = [
  { key: 'eq', label: 'equals', needsValue: 'one' },
  { key: 'neq', label: 'not equals', needsValue: 'one' },
  { key: 'in', label: 'is any of', needsValue: 'list' },
  { key: 'not_in', label: 'is none of', needsValue: 'list' },
  {
    key: 'gte',
    label: 'on or after / ≥',
    needsValue: 'one',
    applicableKinds: ['date', 'timestamp', 'number'],
  },
  {
    key: 'lte',
    label: 'on or before / ≤',
    needsValue: 'one',
    applicableKinds: ['date', 'timestamp', 'number'],
  },
  { key: 'is_null', label: 'is empty', needsValue: 'none' },
  { key: 'is_not_null', label: 'is set', needsValue: 'none' },
  { key: 'is_true', label: 'is yes', needsValue: 'none', applicableKinds: ['enum'] },
  { key: 'is_false', label: 'is no', needsValue: 'none', applicableKinds: ['enum'] },
  { key: 'contains', label: 'contains', needsValue: 'one', applicableKinds: ['text'] },
  {
    key: 'between_days_ago',
    label: 'within last N days',
    needsValue: 'one',
    applicableKinds: ['date', 'timestamp'],
  },
  {
    key: 'due_within_days',
    label: 'due within next N days',
    needsValue: 'one',
    applicableKinds: ['date', 'timestamp'],
  },
  {
    key: 'since_today',
    label: 'is today',
    needsValue: 'none',
    applicableKinds: ['date', 'timestamp'],
  },
  {
    key: 'this_week',
    label: 'is this week',
    needsValue: 'none',
    applicableKinds: ['date', 'timestamp'],
  },
  {
    key: 'this_month',
    label: 'is this month',
    needsValue: 'none',
    applicableKinds: ['date', 'timestamp'],
  },
  {
    key: 'this_year',
    label: 'is this year',
    needsValue: 'none',
    applicableKinds: ['date', 'timestamp'],
  },
  {
    key: 'before_now',
    label: 'is in the past (overdue)',
    needsValue: 'none',
    applicableKinds: ['date', 'timestamp'],
  },
]

export function operatorsForKind(kind: ReportColumnKind): ReportOperatorMeta[] {
  return REPORT_OPERATORS.filter((o) => !o.applicableKinds || o.applicableKinds.includes(kind))
}
