import { sql } from 'drizzle-orm'
import { superDb, type Database } from './client'

// Every tenant-scoped table enforces isolation with FORCE ROW LEVEL SECURITY and
// the policy:
//   tenant_id = current_setting('app.tenant_id')::uuid
// Application code runs every tenant query inside withTenant(), which sets
// app.tenant_id for the transaction. Cross-tenant / super-admin access uses a
// dedicated BYPASSRLS role (beaconhs_super) via withSuperAdmin() — the bypass is
// a ROLE attribute now, not a GUC, so the policy carries no "OR bypass" branch
// (an OR against a session setting is not index-usable and forces a seq scan).

export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`)
    return fn(tx as unknown as Database)
  })
}

// Cross-tenant / super-admin access. Always runs on the dedicated BYPASSRLS pool
// (superDb / beaconhs_super). The first parameter is retained so existing call
// sites — withSuperAdmin(db, fn) — keep compiling unchanged; the connection
// itself always comes from superDb, never the passed handle.
export async function withSuperAdmin<T>(
  _db: Database,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return superDb.transaction(async (tx) => {
    return fn(tx as unknown as Database)
  })
}

// SQL to install on every tenant-scoped table after migrations.
// Generate via drizzle-kit then append this.
//
// FORCE ROW LEVEL SECURITY is required because a table OWNER bypasses non-forced RLS — and the
// runtime app connects as the owner of its tables (beaconhs_app). Without FORCE, tenant isolation
// silently does nothing for the owner role (critical once more than one tenant shares the
// database). Cross-tenant access goes through the dedicated BYPASSRLS role (beaconhs_super); the
// postgres superuser still bypasses regardless.
//
// The predicate is a SINGLE equality on purpose: `tenant_id = current_setting('app.tenant_id')`.
// current_setting() is STABLE, so the planner can push this into an index Cond and use the
// (tenant_id, …) composite indexes. The previous "OR current_setting('app.bypass_rls') = 'on'"
// branch made the whole predicate non-sargable — every RLS-only query degraded to a Seq Scan.
// Bypass is now a ROLE attribute (beaconhs_super), so it needs no branch in the policy.
//
// DROP POLICY IF EXISTS makes this idempotent, so re-running migrate cleanly re-applies the policy
// + FORCE flag instead of erroring on "policy already exists".
//
// nullif(current_setting('app.tenant_id', true), '')::uuid — a custom GUC reverts to '' (empty
// string), not NULL, after a SET LOCAL ends on a pooled connection. Casting ''::uuid throws 22P02,
// and because FORCE RLS makes the owner role evaluate this predicate, that crash would surface on
// any query whose connection previously ran a tenant-scoped tx with no tenant set. nullif maps
// '' → NULL so the cast is safe and the row simply does not match (no rows, not an error).
export const RLS_POLICY_SQL = (table: string) => `
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ${table};
CREATE POLICY tenant_isolation ON ${table}
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
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
  'user_permission_overrides',
  'attachments',
  'form_templates',
  'form_template_versions',
  'form_assignments',
  'form_responses',
  'form_response_steps',
  'form_response_scores',
  'form_response_comments',
  'form_automations',
  'form_response_participants',
  'form_response_checkins',
  'ai_conversations',
  'ai_messages',
  'ai_conversation_shares',
  'incidents',
  'incident_injuries',
  'incident_lost_time_events',
  'training_courses',
  'training_classes',
  'training_class_attendees',
  'training_records',
  'training_certificates',
  'equipment_categories',
  'equipment_types',
  'equipment_items',
  'equipment_location_history',
  'equipment_work_orders',
  'truck_log_entries',
  'equipment_log_entries',
  'equipment_inspection_types',
  'equipment_inspection_groups',
  'equipment_inspection_criteria',
  'equipment_inspection_records',
  'equipment_inspection_record_attachments',
  'equipment_inspection_record_criteria',
  'equipment_checkouts',
  'ppe_types',
  'ppe_items',
  'ppe_issues',
  'ppe_inspections',
  'ppe_issue_reports',
  'ppe_type_inspection_criteria',
  'ppe_type_criteria_groups',
  'ppe_criteria_banks',
  'ppe_criteria_bank_criteria',
  'ppe_annual_records',
  'documents',
  'document_versions',
  'document_drafts',
  'document_comments',
  'document_acknowledgments',
  'document_acknowledgment_sessions',
  'document_reviews',
  'document_books',
  'corrective_actions',
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
  'inspection_type_groups',
  'inspection_type_criteria',
  'inspection_records',
  'inspection_record_attachments',
  'inspection_record_criteria',
  'inspection_assignments',
  'inspection_assignment_compliance',
  'inspection_assignment_dispatches',
  'training_skill_authorities',
  'training_skill_types',
  'training_skill_assignments',
  'training_skill_certificates',
  'training_skill_assignment_files',
  'training_assessment_types',
  'training_assessment_type_questions',
  'training_assessments',
  'training_assessment_results',
  'training_audience_assignments',
  'training_audience_assignment_targets',
  'training_audience_assignment_records',
  'training_course_files',
  'training_extra_fields',
  // Native LMS — curriculum, lessons, enrollments, per-lesson progress
  'training_course_modules',
  'training_lessons',
  'training_enrollments',
  'training_lesson_progress',
  'training_content_items',
  'report_schedules',
  'report_runs',
  'report_definitions',
  'tenant_notification_recipients',
  'tenant_notification_settings',
  'tenant_notification_policy',
  'notification_groups',
  'notification_group_members',
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
  'hazid_assessment_type_apps',
  'hazid_assessments',
  'hazid_assessment_tasks',
  'hazid_assessment_hazards',
  'hazid_assessment_signatures',
  'hazid_assessment_ppe',
  'hazid_assessment_questions',
  'hazid_assessment_photos',
  'hazid_assessment_app_responses',
  'hazid_signed_reports',
  // Daily Journals (individual field-safety log)
  'journal_entries',
  'journal_entry_photos',
  'journal_entry_tags',
  'journal_tags',
  'journal_assignments',
  'journal_assignment_dispatches',
  // User-buildable Insights dashboards + saved Cards (query+viz) + per-user pins
  'insight_dashboards',
  'insight_cards',
  'insight_dashboard_pins',
  // Safe Distance tool — pneumatic pressure-test stored-energy standoff
  // calculator (parent record + its pipe segments).
  'safe_distance_records',
  'safe_distance_segments',
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
  // People — groups / titles assignments
  'person_groups',
  'person_group_memberships',
  'person_titles',
  'person_title_assignments',
  // Per-person uploaded files (resumes, certs, ID copies)
  'person_files',
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
  // SMS delivery log. Same nullable-tenantId + withSuperAdmin-viewer pattern as
  // email_log; the /admin/sms-log viewer reads it outside tenant scope.
  'sms_log',
  // Per-user dashboard layout customisations
  'user_dashboard_layouts',
  // Per-tenant sidebar navigation customisation (editable in /admin/navigation)
  'tenant_nav_config',
  // Unified compliance engine — obligations + audience + dispatch ledger + status
  'compliance_obligations',
  'compliance_audience',
  'compliance_dispatches',
  'compliance_status',
  // Generic admin-managed data sources — binding substrate for data-bound app
  // elements (lookup, cascading dropdowns, data-table, KPI/chart).
  'data_sources',
  'data_source_rows',
  // External data sync — connector instances + identity crosswalk + run ledger.
  'sync_connections',
  'sync_crosswalk',
  'sync_runs',
  // Outbound integrations — per-tenant enablement/config + the export ledger
  // that makes event-driven pushes idempotent and reversible.
  'tenant_integrations',
  'integration_export_log',
  // Unified Flows — human approval gates for ANY subject (forms + native
  // modules); replaces the forms-only form_response_steps gate rows.
  'flow_gates',
  // Tenant-managed email template library (drag-and-drop builder) referenced by
  // the send_email flow action.
  'email_templates',
  // Tenant-managed PDF document template library (paper-size builder) attached by
  // the send_email flow action.
  'pdf_templates',
] as const
