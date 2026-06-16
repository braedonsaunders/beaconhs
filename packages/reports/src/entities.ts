// THE single source of truth for what a custom report can query. Each entity
// carries both the UI metadata (labels, kinds, descriptions — drives the
// report studio) and the SQL metadata (physical table, whitelisted column
// identifiers — drives the executor). This replaces the old pair of
// hand-synced copies (apps/web _builder-meta.ts + apps/worker
// reports-shared.ts whitelists).

import type { ReportFilterOperator } from '@beaconhs/db/schema'

export type ReportColumnKind = 'text' | 'date' | 'timestamp' | 'enum' | 'uuid' | 'number'

export type ReportEntityColumn = {
  /** Public key used in stored query plans (snake_case). */
  key: string
  label: string
  kind: ReportColumnKind
  /** Physical column name. Defaults to `key` when omitted. */
  sql?: string
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
}

export const REPORT_ENTITIES: ReportEntity[] = [
  {
    key: 'incidents',
    label: 'Incidents',
    category: 'incidents',
    description: 'Reported incidents (injury, near-miss, property, environmental, etc.)',
    table: 'incidents',
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
    key: 'inspections',
    label: 'Inspection records',
    category: 'inspections',
    description: 'Inspection records performed against an inspection_type.',
    table: 'inspection_records',
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
    columns: [
      { key: 'key', label: 'Document key', kind: 'text' },
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'category', label: 'Category', kind: 'enum' },
      { key: 'status', label: 'Status', kind: 'enum' },
      { key: 'next_review_on', label: 'Next review on', kind: 'date' },
    ],
    defaultSort: { column: 'next_review_on', direction: 'asc' },
  },
  {
    key: 'equipment',
    label: 'Equipment',
    category: 'equipment',
    description: 'Equipment items in the fleet.',
    table: 'equipment_items',
    columns: [
      { key: 'asset_tag', label: 'Asset tag', kind: 'text' },
      { key: 'name', label: 'Name', kind: 'text' },
      { key: 'serial_number', label: 'Serial number', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'enum' },
      { key: 'current_site_org_unit_id', label: 'Current site (id)', kind: 'uuid' },
      { key: 'next_annual_inspection_due', label: 'Next annual inspection', kind: 'date' },
      { key: 'next_oil_change_due', label: 'Next oil change', kind: 'date' },
    ],
    defaultSort: { column: 'asset_tag', direction: 'asc' },
  },
  {
    key: 'ppe',
    label: 'PPE items',
    category: 'ppe',
    description: 'Individual PPE assets.',
    table: 'ppe_items',
    columns: [
      { key: 'serial_number', label: 'Serial', kind: 'text' },
      { key: 'size', label: 'Size', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'enum' },
      { key: 'next_inspection_due', label: 'Next pre-use inspection', kind: 'date' },
      { key: 'next_annual_inspection_due', label: 'Next annual inspection', kind: 'date' },
      { key: 'expires_on', label: 'Expires on', kind: 'date' },
    ],
    defaultSort: { column: 'next_inspection_due', direction: 'asc' },
  },
  {
    key: 'form_responses',
    label: 'Form responses',
    category: 'forms',
    description:
      'Submitted form responses across all templates (JSHA, toolbox, inspections, custom).',
    table: 'form_responses',
    columns: [
      { key: 'template_id', label: 'Template (id)', kind: 'uuid' },
      { key: 'status', label: 'Status', kind: 'enum' },
      { key: 'compliance_status', label: 'Compliance', kind: 'enum' },
      { key: 'submitted_at', label: 'Submitted at', kind: 'timestamp' },
      { key: 'site_org_unit_id', label: 'Site (id)', kind: 'uuid' },
    ],
    defaultSort: { column: 'submitted_at', direction: 'desc' },
  },
  {
    key: 'form_participants',
    label: 'Form participants',
    category: 'forms',
    description: 'Who participated in / signed which forms (replaces toolbox attendees).',
    table: 'form_response_participants',
    columns: [
      { key: 'person_id', label: 'Person (id)', kind: 'uuid' },
      { key: 'template_id', label: 'Template (id)', kind: 'uuid' },
      { key: 'category', label: 'Category', kind: 'enum' },
      { key: 'signed', label: 'Signed', kind: 'enum' },
      { key: 'occurred_on', label: 'Occurred on', kind: 'date' },
    ],
    defaultSort: { column: 'occurred_on', direction: 'desc' },
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
  { key: 'contains', label: 'contains', needsValue: 'one', applicableKinds: ['text'] },
  {
    key: 'between_days_ago',
    label: 'within last N days',
    needsValue: 'one',
    applicableKinds: ['date', 'timestamp'],
  },
]

export function operatorsForKind(kind: ReportColumnKind): ReportOperatorMeta[] {
  return REPORT_OPERATORS.filter((o) => !o.applicableKinds || o.applicableKinds.includes(kind))
}
