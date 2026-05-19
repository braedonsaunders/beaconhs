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
  'equipment_types',
  'equipment_items',
  'equipment_location_history',
  'equipment_work_orders',
  'ppe_types',
  'ppe_items',
  'ppe_issues',
  'documents',
  'document_versions',
  'document_acknowledgments',
  'document_reviews',
  'document_books',
  'corrective_actions',
  'cs_permits',
  'cs_atmospheric_readings',
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
  'training_skill_authorities',
  'training_skill_types',
  'training_skill_assignments',
  'atmospheric_sensors',
  'atmospheric_calibrations',
] as const
