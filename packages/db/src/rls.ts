import { sql } from 'drizzle-orm'
import type { Database } from './client'

// All tenant-scoped tables have RLS enabled with the policy:
//   tenant_id = current_setting('app.tenant_id')::uuid
// Application code must SET LOCAL app.tenant_id before any tenant-scoped query.
// Super-admin sessions set app.bypass_rls = 'on' to read across tenants.

export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`)
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`)
    return fn(tx as unknown as Database)
  })
}

export async function withSuperAdmin<T>(
  db: Database,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    return fn(tx as unknown as Database)
  })
}

// SQL to install on every tenant-scoped table after migrations.
// Generate via drizzle-kit then append this.
export const RLS_POLICY_SQL = (table: string) => `
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ${table}
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );
`

// Tables that have a `tenant_id` column and need RLS enforcement.
// The Better-Auth tables (user, session, account, verification) are global and
// not in this list.
export const TENANT_SCOPED_TABLES = [
  'org_units',
  'departments',
  'trades',
  'crews',
  'people',
  'people_assignments',
  'customer_contacts',
  'tenant_users',
  'roles',
  'role_assignments',
  'attachments',
  'form_templates',
  'form_template_versions',
  'form_assignments',
  'form_responses',
  'form_response_steps',
  'form_response_scores',
  'form_response_comments',
  'incidents',
  'incident_injuries',
  'incident_lost_time_events',
  'training_courses',
  'training_classes',
  'training_class_attendees',
  'training_assignments',
  'training_records',
  'training_certificates',
  'training_skills',
  'training_skill_evaluations',
  'equipment_categories',
  'equipment_types',
  'equipment_items',
  'equipment_location_history',
  'equipment_work_orders',
  'truck_log_entries',
  'equipment_rates',
  'equipment_expenses',
  'equipment_log_entries',
  'equipment_inspection_types',
  'equipment_inspection_criteria',
  'equipment_checkouts',
  'ppe_types',
  'ppe_items',
  'ppe_issues',
  'ppe_inspections',
  'ppe_issue_reports',
  'ppe_type_inspection_criteria',
  'ppe_annual_records',
  'documents',
  'document_versions',
  'document_acknowledgments',
  'document_reviews',
  'document_books',
  'corrective_actions',
  'cs_permits',
  'cs_atmospheric_readings',
  'cs_permit_personnel',
  'lw_sessions',
  'lw_checkins',
  'notifications',
  'notification_preferences',
  'webpush_subscriptions',
  'tenant_plugins',
  'tenant_plugin_secrets',
  'audit_log',
  'api_keys',
  'inspection_banks',
  'inspection_bank_criteria',
  'inspection_types',
  'inspection_type_banks',
  'inspection_records',
  'inspection_record_attachments',
  'inspection_record_criteria',
  'inspection_assignments',
  'inspection_assignment_compliance',
  'inspection_assignment_dispatches',
  'training_skill_authorities',
  'training_skill_types',
  'training_skill_assignments',
  'training_assessment_types',
  'training_assessment_type_questions',
  'training_assessments',
  'training_assessment_results',
  'training_audience_assignments',
  'training_audience_assignment_targets',
  'training_audience_assignment_records',
  'atmospheric_sensors',
  'atmospheric_calibrations',
  'report_schedules',
  'report_runs',
  'report_dashboards',
  'tenant_notification_recipients',
  'form_assignment_dispatches',
  'plugin_runs',
  'document_book_items',
  'document_references',
  'document_types',
  'document_categories',
  'document_assignments',
  'document_assignment_audience',
  'document_reference_types',
  'document_reference_categories',
  'document_management_reviews',
  'kiosk_scans',
  // HazID / JSHA module
  'hazid_hazard_types',
  'hazid_hazards',
  'hazid_hazard_sets',
  'hazid_tasks',
  'hazid_location_tasks',
  'hazid_assessment_types',
  'hazid_assessment_type_ppe',
  'hazid_assessment_type_questions',
  'hazid_assessments',
  'hazid_assessment_tasks',
  'hazid_assessment_hazards',
  'hazid_assessment_signatures',
  'hazid_assessment_ppe',
  'hazid_assessment_questions',
  'hazid_assessment_photos',
  'hazid_assessment_cs_atmospheric',
  'hazid_assessment_cs_entries',
  'hazid_signed_reports',
  // Toolbox Talks / Journals
  'toolbox_journals',
  'toolbox_journal_attendees',
  'toolbox_journal_photos',
  'toolbox_journal_assignments',
  'toolbox_journal_assignment_dispatches',
  // Safe Distance tool — engineering calc + record-keeping for safe-distance
  // assessments (electrical / drone / overhead-crane proximity).
  'safe_distance_records',
  // Incidents — supporting sub-tables
  'incident_attachments',
  'incident_classifications',
  'incident_injury_types',
  'incident_hours_periods',
  'incident_people',
  // Investigation sub-tables (5-step flow)
  'incident_events',
  'incident_contributing_factors',
  'incident_root_cause_whys',
  'incident_preventative_steps',
  // Job-title task tracking
  'job_title_tasks',
  'job_title_task_acknowledgments',
  // Lift Plans — main + sub-tables
  'lift_plans',
  'lift_plan_loads',
  'lift_plan_equipment',
  'lift_plan_hazards',
  'lift_plan_ppe',
  'lift_plan_signatures',
  'lift_plan_photos',
  // People — divisions / groups / titles assignments
  'person_divisions',
  'person_division_memberships',
  'person_groups',
  'person_group_memberships',
  'person_titles',
  'person_title_assignments',
  // Corrective Actions — photos + multi-step complete wizard
  'ca_photos',
  'ca_complete_steps',
  // Plugin event bus — tenant-scoped fan-out queue
  'plugin_events',
  // Email delivery log. tenantId is NULLABLE for platform sends (magic-link,
  // billing etc.); the default tenant_isolation policy correctly hides NULL
  // rows from regular tenant context. The /admin/email-log viewer uses
  // withSuperAdmin to see those.
  'email_log',
  // Per-user dashboard layout customisations
  'user_dashboard_layouts',
] as const
