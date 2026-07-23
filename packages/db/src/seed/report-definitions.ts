import {
  DEFAULT_REPORT_LAYOUT,
  assertCustomReportDefinition,
  type CustomReportDefinition,
  type ReportCustomQuery,
} from '@appkit/reports'

type BeaconReportSeed = Omit<CustomReportDefinition, 'id' | 'builtIn'> & {
  seedKey: string
  category: string
}

const rows = (
  entity: string,
  columns: string[],
  options: Partial<ReportCustomQuery> = {},
): ReportCustomQuery => ({
  entity,
  mode: 'rows',
  columns,
  filters: null,
  groupBy: null,
  sort: null,
  sorts: null,
  limit: 5000,
  ...options,
})

const summarize = (
  entity: string,
  breakouts: NonNullable<ReportCustomQuery['breakouts']>,
  measures: NonNullable<ReportCustomQuery['measures']>,
  options: Partial<ReportCustomQuery> = {},
): ReportCustomQuery => ({
  entity,
  mode: 'summarize',
  columns: [],
  breakouts,
  measures,
  filters: null,
  groupBy: null,
  sort: null,
  sorts: null,
  limit: 5000,
  ...options,
})

const seed = (
  slug: string,
  name: string,
  description: string,
  category: string,
  query: ReportCustomQuery,
): BeaconReportSeed => ({
  schemaVersion: 1,
  seedKey: slug,
  slug: slug.replaceAll('_', '-'),
  name,
  description,
  category,
  query,
  layout: DEFAULT_REPORT_LAYOUT,
  state: 'published',
  tags: [category, 'beacon-default'],
})

/**
 * The complete BeaconHS report catalogue. These are ordinary editable AppKit
 * definitions seeded once per tenant. A re-seed inserts a missing seed but
 * never overwrites a tenant's edits.
 *
 * Training Matrix intentionally does not appear here: it is an Insights pivot.
 * Equipment charges and ROI intentionally do not appear: financial equipment
 * reporting belongs to the accounting system.
 */
export const BEACON_REPORT_SEEDS: BeaconReportSeed[] = [
  seed(
    'incidents_weekly',
    'Weekly Incidents Summary',
    'Incidents in the current week, grouped by severity.',
    'incidents',
    rows('incidents', ['reference', 'title', 'severity', 'status', 'type', 'occurred_at'], {
      filters: {
        combinator: 'and',
        rules: [{ field: 'occurred_at', op: 'this_week' }],
      },
      groupBy: 'severity',
      sorts: [{ column: 'occurred_at', direction: 'desc' }],
    }),
  ),
  seed(
    'corrective_actions_open',
    'Open Corrective Actions',
    'Open, in-progress, and pending-verification corrective actions grouped by status.',
    'corrective_actions',
    rows(
      'corrective_actions',
      [
        'reference',
        'title',
        'severity',
        'status',
        'owner_name',
        'department_name',
        'location_name',
        'due_on',
        'assigned_on',
        'source',
      ],
      {
        filters: {
          combinator: 'and',
          rules: [
            {
              field: 'status',
              op: 'in',
              value: ['open', 'in_progress', 'pending_verification'],
            },
          ],
        },
        groupBy: 'status',
        sorts: [{ column: 'due_on', direction: 'asc' }],
      },
    ),
  ),
  seed(
    'inspections_completed_weekly',
    'Inspections Completed (weekly)',
    'Completed inspections in the current week, grouped by inspection type.',
    'inspections',
    rows(
      'inspection_records',
      ['reference', 'status', 'occurred_at', 'location_on_site', 'type_id', 'site_org_unit_id'],
      {
        filters: {
          combinator: 'and',
          rules: [
            { field: 'status', op: 'in', value: ['submitted', 'closed'] },
            { field: 'occurred_at', op: 'this_week' },
          ],
        },
        groupBy: 'type_id',
        sorts: [{ column: 'occurred_at', direction: 'desc' }],
      },
    ),
  ),
  seed(
    'documents_overdue_review',
    'Documents Overdue Review',
    'Published documents whose next review date has passed.',
    'documents',
    rows('documents', ['key', 'title', 'status', 'next_review_on'], {
      filters: {
        combinator: 'and',
        rules: [
          { field: 'status', op: 'eq', value: 'published' },
          { field: 'next_review_on', op: 'before_now' },
        ],
      },
      sorts: [{ column: 'next_review_on', direction: 'asc' }],
    }),
  ),
  seed(
    'safety_kpi_monthly',
    'Monthly Safety KPI Pack',
    'Monthly recordable incidents, DART incidents, and hours-worked safety rate inputs.',
    'cross_module',
    summarize(
      'incident_rates',
      [{ column: 'month', bin: 'month', label: 'Month' }],
      [
        { fn: 'sum', column: 'recordable_count', label: 'Recordable incidents' },
        { fn: 'sum', column: 'dart_count', label: 'DART incidents' },
        { fn: 'sum', column: 'hours_worked', label: 'Hours worked' },
      ],
      {
        filters: {
          combinator: 'and',
          rules: [{ field: 'month', op: 'this_year' }],
        },
      },
    ),
  ),
  seed(
    'site_safety_scorecard',
    'Site Safety Scorecard',
    'Incident activity by site for the current month.',
    'cross_module',
    summarize(
      'incidents',
      [{ column: 'site_org_unit_id', label: 'Site' }],
      [{ fn: 'count', label: 'Incidents' }],
      {
        filters: {
          combinator: 'and',
          rules: [{ field: 'occurred_at', op: 'this_month' }],
        },
      },
    ),
  ),
  seed(
    'overdue_everything',
    'Overdue Items (All Modules)',
    'Current overdue compliance obligations from every module.',
    'cross_module',
    rows(
      'compliance_status',
      [
        'source_module',
        'obligation_title',
        'person_name',
        'status',
        'period_start',
        'period_end',
        'due_on',
        'percent',
      ],
      {
        filters: {
          combinator: 'and',
          rules: [{ field: 'status', op: 'eq', value: 'overdue' }],
        },
        groupBy: 'source_module',
        sorts: [{ column: 'due_on', direction: 'asc' }],
      },
    ),
  ),
  seed(
    'lone_worker_weekly',
    'Weekly Monitored Sessions',
    'Monitored sessions started this week, grouped by session status.',
    'lone_worker',
    rows(
      'monitored_sessions',
      [
        'subject_person_id',
        'site_org_unit_id',
        'monitor_status',
        'created_at',
        'last_checkin_at',
        'next_checkin_due_at',
        'expected_end_at',
      ],
      {
        filters: {
          combinator: 'and',
          rules: [{ field: 'created_at', op: 'this_week' }],
        },
        groupBy: 'monitor_status',
        sorts: [{ column: 'created_at', direction: 'desc' }],
      },
    ),
  ),
  seed(
    'training_compliance_snapshot',
    'Training Compliance Snapshot',
    'Current training compliance by obligation and employee.',
    'training',
    rows(
      'compliance_status',
      ['obligation_title', 'person_name', 'status', 'due_on', 'count', 'expected', 'percent'],
      {
        filters: {
          combinator: 'and',
          rules: [{ field: 'source_module', op: 'in', value: ['training', 'cert_requirement'] }],
        },
        groupBy: 'status',
        sorts: [{ column: 'due_on', direction: 'asc' }],
      },
    ),
  ),
  seed(
    'document_compliance_snapshot',
    'Document Compliance Snapshot',
    'Current document acknowledgment compliance by obligation and employee.',
    'documents',
    rows(
      'compliance_status',
      ['obligation_title', 'person_name', 'status', 'due_on', 'count', 'expected', 'percent'],
      {
        filters: {
          combinator: 'and',
          rules: [{ field: 'source_module', op: 'eq', value: 'document' }],
        },
        groupBy: 'status',
        sorts: [{ column: 'due_on', direction: 'asc' }],
      },
    ),
  ),
  seed(
    'incidents_trend_12m',
    'Incidents Trend (12 months)',
    'Monthly incident counts by severity over the rolling year.',
    'incidents',
    summarize(
      'incidents',
      [
        { column: 'occurred_at', bin: 'month', label: 'Month' },
        { column: 'severity', label: 'Severity' },
      ],
      [{ fn: 'count', label: 'Incidents' }],
      {
        filters: {
          combinator: 'and',
          rules: [{ field: 'occurred_at', op: 'between_days_ago', value: 365 }],
        },
      },
    ),
  ),
  seed(
    'osha_300_log',
    'OSHA 300 Recordable Log',
    'Recordable incident register for the rolling year.',
    'incidents',
    rows(
      'incidents',
      [
        'reference',
        'title',
        'type',
        'severity',
        'status',
        'occurred_at',
        'actual_severity',
        'potential_severity',
      ],
      {
        filters: {
          combinator: 'and',
          rules: [
            {
              field: 'severity',
              op: 'in',
              value: ['medical_aid', 'lost_time', 'fatality'],
            },
            { field: 'occurred_at', op: 'between_days_ago', value: 365 },
          ],
        },
        sorts: [{ column: 'occurred_at', direction: 'asc' }],
      },
    ),
  ),
  seed(
    'compliance_by_entity',
    'Compliance — By Entity',
    'Every current subject covered by a compliance obligation.',
    'cross_module',
    rows(
      'compliance_status',
      [
        'source_module',
        'obligation_title',
        'subject_key',
        'status',
        'count',
        'expected',
        'percent',
        'period_start',
        'period_end',
        'due_on',
      ],
      {
        groupBy: 'obligation_title',
        sorts: [{ column: 'due_on', direction: 'asc' }],
      },
    ),
  ),
  seed(
    'compliance_by_person',
    'Compliance — By Person',
    'Current compliance requirements grouped by employee across all modules.',
    'cross_module',
    rows(
      'compliance_status',
      ['person_name', 'source_module', 'obligation_title', 'status', 'due_on', 'percent'],
      {
        groupBy: 'person_name',
        sorts: [{ column: 'due_on', direction: 'asc' }],
      },
    ),
  ),
  seed(
    'hazid_signatures',
    'Hazard ID — Signatures',
    'Hazard assessment signatures with signer, role, and signing time.',
    'hazid',
    rows(
      'hazid_signatures',
      ['assessment_id', 'signature_type', 'person_id', 'external_name', 'signed_at'],
      {
        groupBy: 'assessment_id',
        sorts: [{ column: 'signed_at', direction: 'desc' }],
      },
    ),
  ),
  seed(
    'training_certificates',
    'Training — Certificates',
    'Held training certificates. Filter people and courses; group by employee or course.',
    'training',
    rows(
      'training_matrix',
      [
        'employee_no',
        'person_name',
        'department_name',
        'course_code',
        'course_name',
        'course_type',
        'delivery_type',
        'completed_on',
        'expires_on',
        'coverage_status',
      ],
      {
        filters: {
          combinator: 'and',
          rules: [{ field: 'coverage_status', op: 'neq', value: 'missing' }],
        },
        groupBy: 'person_name',
        sorts: [{ column: 'person_name', direction: 'asc' }],
      },
    ),
  ),
  seed(
    'training_expired_upcoming',
    'Training — Expired & Upcoming',
    'Expired certificates and certificates expiring within 90 days. Group by employee or course.',
    'training',
    rows(
      'training_matrix',
      [
        'employee_no',
        'person_name',
        'department_name',
        'course_code',
        'course_name',
        'expires_on',
        'coverage_status',
      ],
      {
        filters: {
          combinator: 'and',
          rules: [{ field: 'coverage_status', op: 'in', value: ['expired', 'expiring'] }],
        },
        groupBy: 'person_name',
        sorts: [{ column: 'expires_on', direction: 'asc' }],
      },
    ),
  ),
  seed(
    'training_missing',
    'Training — Missing',
    'Required courses that are missing, expired, or expiring. Group by employee or course.',
    'training',
    rows(
      'training_matrix',
      [
        'employee_no',
        'person_name',
        'department_name',
        'course_code',
        'course_name',
        'coverage_status',
        'expires_on',
      ],
      {
        filters: {
          combinator: 'and',
          rules: [
            { field: 'is_required', op: 'is_true' },
            {
              field: 'coverage_status',
              op: 'in',
              value: ['missing', 'expired', 'expiring'],
            },
          ],
        },
        groupBy: 'person_name',
        sorts: [{ column: 'person_name', direction: 'asc' }],
      },
    ),
  ),
  seed(
    'skills_matrix',
    'Skills — Matrix',
    'Externally issued skills and certifications grouped by issuing authority.',
    'training',
    rows(
      'skill_assignments',
      [
        'employee_no',
        'last_name',
        'first_name',
        'trade',
        'authority',
        'certification_code',
        'certification_name',
        'granted_on',
        'expires_on',
        'status',
      ],
      {
        groupBy: 'authority',
        sorts: [{ column: 'last_name', direction: 'asc' }],
      },
    ),
  ),
  seed(
    'skills_expired_upcoming',
    'Skills — Expired & Upcoming',
    'Expired skills and skills expiring within 90 days.',
    'training',
    rows(
      'skill_assignments',
      [
        'employee_no',
        'last_name',
        'first_name',
        'authority',
        'certification_code',
        'certification_name',
        'expires_on',
        'status',
      ],
      {
        filters: {
          combinator: 'and',
          rules: [{ field: 'status', op: 'in', value: ['expired', 'expiring'] }],
        },
        groupBy: 'certification_name',
        sorts: [{ column: 'expires_on', direction: 'asc' }],
      },
    ),
  ),
  seed(
    'skills_missing',
    'Skills — Missing & Expired',
    'Missing or overdue externally issued skill obligations.',
    'training',
    rows('compliance_status', ['person_name', 'obligation_title', 'status', 'due_on', 'percent'], {
      filters: {
        combinator: 'and',
        rules: [
          { field: 'source_module', op: 'eq', value: 'cert_requirement' },
          { field: 'status', op: 'in', value: ['pending', 'overdue'] },
        ],
      },
      groupBy: 'person_name',
      sorts: [{ column: 'due_on', direction: 'asc' }],
    }),
  ),
  seed(
    'skills_cwb',
    'Skills — CWB (Welding)',
    'Canadian Welding Bureau qualification roster.',
    'training',
    rows(
      'skill_assignments',
      [
        'employee_no',
        'last_name',
        'first_name',
        'trade',
        'authority',
        'certification_code',
        'certification_name',
        'cwb_standard',
        'cwb_type',
        'cwb_process',
        'cwb_position',
        'cwb_level',
        'granted_on',
        'expires_on',
        'status',
      ],
      {
        filters: {
          combinator: 'and',
          rules: [{ field: 'authority', op: 'contains', value: 'CWB' }],
        },
        groupBy: 'certification_name',
        sorts: [{ column: 'last_name', direction: 'asc' }],
      },
    ),
  ),
  seed(
    'corrective_actions_list',
    'Corrective Actions — List',
    'Every corrective action grouped by status and sorted by due date.',
    'corrective_actions',
    rows(
      'corrective_actions',
      [
        'reference',
        'title',
        'severity',
        'status',
        'owner_name',
        'department_name',
        'location_name',
        'due_on',
        'assigned_on',
        'source',
      ],
      {
        groupBy: 'status',
        sorts: [{ column: 'due_on', direction: 'asc' }],
      },
    ),
  ),
  seed(
    'ppe_list',
    'PPE — List',
    'All active PPE items with serial, size, holder, status, and inspection dates.',
    'ppe',
    rows(
      'ppe_items',
      [
        'serial_number',
        'ppe_type',
        'size',
        'status',
        'holder_name',
        'department_name',
        'last_inspection_on',
        'next_inspection_due',
        'next_annual_inspection_due',
        'expires_on',
      ],
      {
        filters: {
          combinator: 'and',
          rules: [{ field: 'status', op: 'in', value: ['issued', 'in_stock'] }],
        },
        groupBy: 'status',
        sorts: [{ column: 'serial_number', direction: 'asc' }],
      },
    ),
  ),
  seed(
    'ppe_expired_upcoming',
    'PPE — Expired & Upcoming',
    'Active PPE whose annual inspection is overdue or due within 90 days.',
    'ppe',
    rows(
      'ppe_items',
      [
        'serial_number',
        'ppe_type',
        'size',
        'status',
        'holder_name',
        'department_name',
        'last_inspection_on',
        'next_annual_inspection_due',
      ],
      {
        filters: {
          combinator: 'and',
          rules: [
            { field: 'status', op: 'in', value: ['issued', 'in_stock'] },
            { field: 'next_annual_inspection_due', op: 'due_within_days', value: 90 },
          ],
        },
        sorts: [{ column: 'next_annual_inspection_due', direction: 'asc' }],
      },
    ),
  ),
  seed(
    'ppe_expiring',
    'PPE — Expiring soon',
    'Active PPE whose service life expires within 30 days.',
    'ppe',
    rows(
      'ppe_items',
      ['serial_number', 'ppe_type', 'size', 'status', 'holder_name', 'expires_on'],
      {
        filters: {
          combinator: 'and',
          rules: [
            { field: 'status', op: 'in', value: ['issued', 'in_stock'] },
            { field: 'expires_on', op: 'due_within_days', value: 30 },
          ],
        },
        sorts: [{ column: 'expires_on', direction: 'asc' }],
      },
    ),
  ),
  seed(
    'ppe_inspection_due',
    'PPE — Inspection due',
    'Active PPE whose pre-use inspection is overdue or due within 14 days.',
    'ppe',
    rows(
      'ppe_items',
      [
        'serial_number',
        'ppe_type',
        'size',
        'status',
        'holder_name',
        'last_inspection_on',
        'next_inspection_due',
      ],
      {
        filters: {
          combinator: 'and',
          rules: [
            { field: 'status', op: 'in', value: ['issued', 'in_stock'] },
            { field: 'next_inspection_due', op: 'due_within_days', value: 14 },
          ],
        },
        sorts: [{ column: 'next_inspection_due', direction: 'asc' }],
      },
    ),
  ),
  seed(
    'vehicle_log_monthly',
    'Vehicle Log — Monthly Summary',
    'Asset-by-month vehicle log summary with driver, distance, hours, crew, and source coverage.',
    'equipment',
    rows(
      'vehicle_log_monthly',
      [
        'asset_tag',
        'vehicle_name',
        'driver_name',
        'month',
        'logged_days',
        'business_km',
        'personal_km',
        'total_km',
        'hours_on_site',
        'manpower_count',
        'imported_days',
        'manual_days',
        'site_count',
      ],
      {
        groupBy: 'asset_tag',
        sorts: [{ column: 'month', direction: 'asc' }],
        limit: 10000,
      },
    ),
  ),
  seed(
    'equipment_fleet',
    'Equipment — Fleet',
    'In-service assets with type, site, holder, usage, and next inspection.',
    'equipment',
    rows(
      'equipment_fleet',
      [
        'asset_tag',
        'name',
        'equipment_type',
        'status',
        'site_name',
        'holder_name',
        'hours_ytd',
        'km_ytd',
        'last_inspection_on',
        'next_inspection_due',
      ],
      {
        filters: {
          combinator: 'and',
          rules: [{ field: 'status', op: 'eq', value: 'in_service' }],
        },
        sorts: [{ column: 'asset_tag', direction: 'asc' }],
      },
    ),
  ),
  seed(
    'equipment_inspections',
    'Equipment — Upcoming & overdue inspections',
    'Assets whose scheduled inspection is overdue or due within 30 days.',
    'equipment',
    rows(
      'equipment_fleet',
      [
        'asset_tag',
        'name',
        'equipment_type',
        'site_name',
        'holder_name',
        'last_inspection_on',
        'next_inspection_due',
      ],
      {
        filters: {
          combinator: 'and',
          rules: [{ field: 'next_inspection_due', op: 'due_within_days', value: 30 }],
        },
        sorts: [{ column: 'next_inspection_due', direction: 'asc' }],
      },
    ),
  ),
  seed(
    'equipment_oil_change_due',
    'Equipment — Upcoming & overdue oil changes',
    'Assets whose oil change is overdue or due within 30 days.',
    'equipment',
    rows(
      'equipment_fleet',
      [
        'asset_tag',
        'name',
        'equipment_type',
        'site_name',
        'holder_name',
        'last_oil_change_on',
        'next_oil_change_due',
        'oil_change_interval_months',
      ],
      {
        filters: {
          combinator: 'and',
          rules: [
            { field: 'requires_oil_change', op: 'is_true' },
            { field: 'next_oil_change_due', op: 'due_within_days', value: 30 },
          ],
        },
        sorts: [{ column: 'next_oil_change_due', direction: 'asc' }],
      },
    ),
  ),
]

for (const definition of BEACON_REPORT_SEEDS) {
  assertCustomReportDefinition({ ...definition, id: definition.seedKey })
}

export const EXPECTED_BEACON_REPORT_SEED_KEYS = BEACON_REPORT_SEEDS.map(
  (definition) => definition.seedKey,
)
