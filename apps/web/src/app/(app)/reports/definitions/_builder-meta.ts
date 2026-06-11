// Metadata that drives the custom-report builder UI. The list of entities,
// per-entity columns, and supported filter operators is the source of truth
// for both the form and the worker dispatcher in apps/worker (which holds
// its own table+column whitelist for SQL-injection safety). The two must
// stay in sync — see apps/worker/src/workers/reports-shared.ts.

export type BuilderColumn = {
  key: string
  label: string
  kind: 'text' | 'date' | 'timestamp' | 'enum' | 'uuid' | 'number'
}

export type BuilderEntity = {
  key: string
  label: string
  category: string
  /** A line of helpful text shown under the entity name in the picker. */
  description: string
  /** Columns selectable for output AND filterable. Order is preserved in the picker. */
  columns: BuilderColumn[]
  /** Default sort column (must appear in `columns`). */
  defaultSort?: { column: string; direction: 'asc' | 'desc' }
}

export const BUILDER_ENTITIES: BuilderEntity[] = [
  {
    key: 'incidents',
    label: 'Incidents',
    category: 'incidents',
    description: 'Reported incidents (injury, near-miss, property, environmental, etc.)',
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
    key: 'lone_worker',
    label: 'Lone-worker sessions',
    category: 'lone_worker',
    description: 'Lone-worker check-in sessions (active, completed, missed, escalated).',
    columns: [
      { key: 'status', label: 'Status', kind: 'enum' },
      { key: 'task', label: 'Task', kind: 'text' },
      { key: 'started_at', label: 'Started at', kind: 'timestamp' },
      { key: 'expected_end_at', label: 'Expected end', kind: 'timestamp' },
      { key: 'interval_minutes', label: 'Interval (min)', kind: 'number' },
    ],
    defaultSort: { column: 'started_at', direction: 'desc' },
  },
  {
    key: 'form_responses',
    label: 'Form responses',
    category: 'forms',
    description:
      'Submitted form responses across all templates (JSHA, toolbox, inspections, custom).',
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
    columns: [
      { key: 'person_id', label: 'Person (id)', kind: 'uuid' },
      { key: 'template_id', label: 'Template (id)', kind: 'uuid' },
      { key: 'category', label: 'Category', kind: 'enum' },
      { key: 'signed', label: 'Signed', kind: 'enum' },
      { key: 'occurred_on', label: 'Occurred on', kind: 'date' },
    ],
    defaultSort: { column: 'occurred_on', direction: 'desc' },
  },
]

export const BUILDER_ENTITY_MAP: Record<string, BuilderEntity> = Object.fromEntries(
  BUILDER_ENTITIES.map((e) => [e.key, e]),
)

export type BuilderOperator = {
  key: string
  label: string
  /** Whether this op needs a value field next to it. */
  needsValue: 'none' | 'one' | 'list'
  /** Restrict to specific column kinds (undefined = applies to all). */
  applicableKinds?: BuilderColumn['kind'][]
}

export const BUILDER_OPERATORS: BuilderOperator[] = [
  { key: 'eq', label: 'equals', needsValue: 'one' },
  { key: 'neq', label: 'not equals', needsValue: 'one' },
  { key: 'in', label: 'in (comma-sep)', needsValue: 'list' },
  { key: 'not_in', label: 'not in (comma-sep)', needsValue: 'list' },
  { key: 'gte', label: '>=', needsValue: 'one', applicableKinds: ['date', 'timestamp', 'number'] },
  { key: 'lte', label: '<=', needsValue: 'one', applicableKinds: ['date', 'timestamp', 'number'] },
  { key: 'is_null', label: 'is empty', needsValue: 'none' },
  { key: 'is_not_null', label: 'is set', needsValue: 'none' },
  { key: 'contains', label: 'contains (text)', needsValue: 'one', applicableKinds: ['text'] },
  {
    key: 'between_days_ago',
    label: 'within last N days',
    needsValue: 'one',
    applicableKinds: ['date', 'timestamp'],
  },
]
