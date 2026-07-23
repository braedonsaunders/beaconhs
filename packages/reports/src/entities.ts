// THE single source of truth for what a custom report can query. Each entity
// carries both the UI metadata (labels, kinds, descriptions — drives the
// report studio) and the SQL metadata (physical table, whitelisted column
// identifiers — drives the executor). This replaces the old pair of
// hand-synced copies (apps/web _builder-meta.ts + apps/worker
// reports-shared.ts whitelists).

import {
  reportColumn,
  reportColumnExpression,
  type ReportColumnKind,
  type ReportEntity as AppKitReportEntity,
  type ReportEntityColumn,
  type ReportEntityCatalog,
} from '@appkit/reports'

export type ReportEntity = AppKitReportEntity & { table: string }
export type { ReportColumnKind, ReportEntityColumn, ReportEntityCatalog }

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
    table: 'report_corrective_actions',
    softDelete: true,
    columns: [
      { key: 'reference', label: 'Reference', kind: 'text' },
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'severity', label: 'Severity', kind: 'enum' },
      { key: 'status', label: 'Status', kind: 'enum' },
      { key: 'due_on', label: 'Due on', kind: 'date' },
      { key: 'assigned_on', label: 'Assigned on', kind: 'date' },
      { key: 'source', label: 'Source', kind: 'enum' },
      { key: 'owner_tenant_user_id', label: 'Owner (id)', kind: 'uuid' },
      { key: 'owner_name', label: 'Owner', kind: 'text' },
      { key: 'department_id', label: 'Department (id)', kind: 'uuid' },
      { key: 'department_name', label: 'Department', kind: 'text' },
      { key: 'group_id_list', label: 'Person group', kind: 'text' },
      { key: 'site_org_unit_id', label: 'Site (id)', kind: 'uuid' },
      { key: 'location_name', label: 'Location', kind: 'text' },
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
      { key: 'cwb_standard', label: 'CWB standard', kind: 'text' },
      { key: 'cwb_type', label: 'CWB type', kind: 'text' },
      { key: 'cwb_process', label: 'CWB process', kind: 'text' },
      { key: 'cwb_position', label: 'CWB position', kind: 'text' },
      { key: 'cwb_level', label: 'CWB level', kind: 'text' },
      { key: 'granted_on', label: 'Granted on', kind: 'date' },
      { key: 'expires_on', label: 'Expires on', kind: 'date' },
      { key: 'status', label: 'Status', kind: 'enum' },
      { key: 'person_id', label: 'Person (id)', kind: 'uuid' },
      { key: 'department_id', label: 'Department (id)', kind: 'uuid' },
      { key: 'group_id_list', label: 'Person group', kind: 'text' },
      { key: 'skill_type_id', label: 'Skill type (id)', kind: 'uuid' },
      { key: 'authority_id', label: 'Authority (id)', kind: 'uuid' },
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
      { key: 'location_on_site', label: 'Location on site', kind: 'text' },
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
      { key: 'requires_oil_change', label: 'Requires oil change', kind: 'boolean' },
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
    table: 'report_ppe_items',
    softDelete: true,
    columns: [
      { key: 'type_id', label: 'PPE type (id)', kind: 'uuid' },
      { key: 'ppe_type', label: 'PPE type', kind: 'text' },
      { key: 'serial_number', label: 'Serial', kind: 'text' },
      { key: 'size', label: 'Size', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'enum' },
      { key: 'current_holder_person_id', label: 'Current holder (id)', kind: 'uuid' },
      { key: 'holder_name', label: 'Current holder', kind: 'text' },
      { key: 'department_id', label: 'Department (id)', kind: 'uuid' },
      { key: 'department_name', label: 'Department', kind: 'text' },
      { key: 'group_id_list', label: 'Person group', kind: 'text' },
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
      { key: 'person_id', label: 'Person (id)', kind: 'uuid' },
      { key: 'employee_no', label: 'Employee #', kind: 'text' },
      { key: 'last_name', label: 'Last name', kind: 'text' },
      { key: 'first_name', label: 'First name', kind: 'text' },
      { key: 'person_name', label: 'Person', kind: 'text' },
      { key: 'course_id', label: 'Course (id)', kind: 'uuid' },
      { key: 'course_code', label: 'Course code', kind: 'text' },
      { key: 'course_name', label: 'Course', kind: 'text' },
      { key: 'course_type', label: 'Course type', kind: 'text' },
      { key: 'completed_on', label: 'Completed on', kind: 'date' },
      { key: 'expires_on', label: 'Expires on', kind: 'date' },
      { key: 'coverage_status', label: 'Coverage', kind: 'enum' },
      { key: 'department_id', label: 'Department (id)', kind: 'uuid' },
      { key: 'department_name', label: 'Department', kind: 'text' },
      { key: 'delivery_type', label: 'Course delivery type', kind: 'enum' },
      { key: 'group_id_list', label: 'Person group', kind: 'text' },
      { key: 'is_required', label: 'Required', kind: 'boolean' },
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
  {
    key: 'compliance_status',
    label: 'Compliance status',
    category: 'compliance',
    description:
      'Materialized compliance results with the obligation, source module, and person names resolved.',
    table: 'report_compliance_status',
    from: `(
      SELECT
        status.id,
        status.tenant_id,
        obligation.source_module,
        obligation.title AS obligation_title,
        status.subject_key,
        CASE
          WHEN person.id IS NULL THEN NULL
          ELSE person.last_name || ', ' || person.first_name
        END AS person_name,
        status.status,
        status.period_start,
        status.period_end,
        status.due_on,
        status.completed_on,
        status.count,
        status.expected,
        status.percent,
        status.computed_at
      FROM compliance_status status
      JOIN compliance_obligations obligation
        ON obligation.tenant_id = status.tenant_id
       AND obligation.id = status.obligation_id
       AND obligation.deleted_at IS NULL
      LEFT JOIN people person
        ON person.tenant_id = status.tenant_id
       AND person.id = status.person_id
       AND person.deleted_at IS NULL
    ) AS "report_compliance_status"`,
    columns: [
      { key: 'source_module', label: 'Module', kind: 'enum' },
      { key: 'obligation_title', label: 'Requirement', kind: 'text' },
      { key: 'subject_key', label: 'Subject', kind: 'text' },
      { key: 'person_name', label: 'Employee', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'enum' },
      { key: 'period_start', label: 'Period start', kind: 'date' },
      { key: 'period_end', label: 'Period end', kind: 'date' },
      { key: 'due_on', label: 'Due on', kind: 'date' },
      { key: 'completed_on', label: 'Completed on', kind: 'date' },
      { key: 'count', label: 'Completed', kind: 'number' },
      { key: 'expected', label: 'Expected', kind: 'number' },
      { key: 'percent', label: 'Compliance %', kind: 'number' },
      { key: 'computed_at', label: 'Computed at', kind: 'timestamp' },
    ],
    defaultSort: { column: 'due_on', direction: 'asc' },
  },
  {
    key: 'monitored_sessions',
    label: 'Monitored sessions',
    category: 'lone_worker',
    description: 'Live monitored form sessions such as Lone Worker check-ins.',
    table: 'report_monitored_sessions',
    from: `(
      SELECT
        id,
        tenant_id,
        subject_person_id,
        site_org_unit_id,
        monitor_status,
        checkin_interval_minutes,
        grace_period_minutes,
        expected_end_at,
        next_checkin_due_at,
        last_checkin_at,
        escalated_at,
        created_at,
        closed_at
      FROM form_responses
      WHERE monitor_status IS NOT NULL
        AND deleted_at IS NULL
    ) AS "report_monitored_sessions"`,
    columns: [
      { key: 'subject_person_id', label: 'Employee (id)', kind: 'uuid' },
      { key: 'site_org_unit_id', label: 'Location (id)', kind: 'uuid' },
      { key: 'monitor_status', label: 'Status', kind: 'enum' },
      { key: 'checkin_interval_minutes', label: 'Check-in interval', kind: 'number' },
      { key: 'grace_period_minutes', label: 'Grace period', kind: 'number' },
      { key: 'expected_end_at', label: 'Expected end', kind: 'timestamp' },
      { key: 'next_checkin_due_at', label: 'Next check-in', kind: 'timestamp' },
      { key: 'last_checkin_at', label: 'Last check-in', kind: 'timestamp' },
      { key: 'escalated_at', label: 'Escalated at', kind: 'timestamp' },
      { key: 'created_at', label: 'Started at', kind: 'timestamp' },
      { key: 'closed_at', label: 'Closed at', kind: 'timestamp' },
    ],
    defaultSort: { column: 'created_at', direction: 'desc' },
  },
  {
    key: 'hazid_signatures',
    label: 'Hazard assessment signatures',
    category: 'hazid',
    description: 'Recorded internal and external signatures on hazard assessments.',
    table: 'hazid_assessment_signatures',
    columns: [
      { key: 'assessment_id', label: 'Assessment (id)', kind: 'uuid' },
      { key: 'signature_type', label: 'Signature type', kind: 'enum' },
      { key: 'person_id', label: 'Employee (id)', kind: 'uuid' },
      { key: 'external_name', label: 'External signer', kind: 'text' },
      { key: 'signed_at', label: 'Signed at', kind: 'timestamp' },
    ],
    defaultSort: { column: 'signed_at', direction: 'desc' },
  },
]

export const BEACON_REPORT_CATALOG: ReportEntityCatalog = { entities: REPORT_ENTITIES }

export const REPORT_ENTITY_MAP: Record<string, ReportEntity> = Object.fromEntries(
  REPORT_ENTITIES.map((e) => [e.key, e]),
)

export function entityColumn(entity: ReportEntity, key: string): ReportEntityColumn | null {
  return reportColumn(entity, key)
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
  return reportColumnExpression(entity, key)
}
