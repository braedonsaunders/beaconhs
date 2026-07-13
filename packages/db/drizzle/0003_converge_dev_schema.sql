-- Restore the people custom-field GIN index that was accidentally removed
-- from the Drizzle schema when the account-link indexes were added. Existing
-- development databases already have it; clean databases receive it here.
CREATE INDEX IF NOT EXISTS "people_metadata_gin" ON "people" USING gin ("metadata");--> statement-breakpoint

-- The API-key audience field was renamed in code. Preserve any existing data
-- and fail closed if the catalog is in an ambiguous or unknown state.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'scopes'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'permissions'
  ) THEN
    RAISE EXCEPTION 'api_keys contains both scopes and permissions columns';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'scopes'
  ) THEN
    ALTER TABLE "api_keys" RENAME COLUMN "scopes" TO "permissions";
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'permissions'
  ) THEN
    RAISE EXCEPTION 'api_keys contains neither scopes nor permissions column';
  END IF;
END
$$;--> statement-breakpoint

-- These flags belonged to the retired fixed HazID layout. Current assessment
-- types derive their sections from the configured questions/tasks/hazards.
ALTER TABLE "hazid_assessment_types" DROP COLUMN IF EXISTS "has_hazards";--> statement-breakpoint
ALTER TABLE "hazid_assessment_types" DROP COLUMN IF EXISTS "has_tasks";--> statement-breakpoint

-- Match the canonical schema's explicit JSON null default.
ALTER TABLE "tenant_notification_policy"
  ALTER COLUMN "quiet_hours" SET DEFAULT 'null'::jsonb;--> statement-breakpoint

-- This foreign key intentionally remains migration-managed to avoid the
-- equipment/equipment-inspections schema import cycle.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.equipment_items'::regclass
      AND conname = 'equipment_items_pre_use_inspection_type_id_fk'
  ) THEN
    ALTER TABLE "equipment_items"
      ADD CONSTRAINT "equipment_items_pre_use_inspection_type_id_fk"
      FOREIGN KEY ("pre_use_inspection_type_id")
      REFERENCES "equipment_inspection_types" ("id")
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "equipment_items"
  VALIDATE CONSTRAINT "equipment_items_pre_use_inspection_type_id_fk";--> statement-breakpoint

-- The lock owner relationship existed in the TypeScript schema but was absent
-- from the pre-cutover development database.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.form_responses'::regclass
      AND conname = 'form_responses_locked_by_tenant_user_id_tenant_users_id_fk'
  ) THEN
    ALTER TABLE "form_responses"
      ADD CONSTRAINT "form_responses_locked_by_tenant_user_id_tenant_users_id_fk"
      FOREIGN KEY ("locked_by_tenant_user_id")
      REFERENCES "tenant_users" ("id")
      NOT VALID;
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "form_responses"
  VALIDATE CONSTRAINT "form_responses_locked_by_tenant_user_id_tenant_users_id_fk";--> statement-breakpoint

-- Earlier hand-written migrations used PostgreSQL's short `_fkey` names while
-- the clean Drizzle baseline uses deterministic relation names. Normalize the
-- names without rebuilding or revalidating equivalent constraints.
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('ai_conversation_shares', 'ai_conversation_shares_conversation_id_fkey', 'ai_conversation_shares_conversation_id_ai_conversations_id_fk'),
      ('ai_conversation_shares', 'ai_conversation_shares_created_by_user_id_fkey', 'ai_conversation_shares_created_by_user_id_user_id_fk'),
      ('ai_conversation_shares', 'ai_conversation_shares_target_role_id_fkey', 'ai_conversation_shares_target_role_id_roles_id_fk'),
      ('ai_conversation_shares', 'ai_conversation_shares_target_user_id_fkey', 'ai_conversation_shares_target_user_id_user_id_fk'),
      ('ai_conversation_shares', 'ai_conversation_shares_tenant_id_fkey', 'ai_conversation_shares_tenant_id_tenants_id_fk'),
      ('email_templates', 'email_templates_created_by_tenant_user_id_fkey', 'email_templates_created_by_tenant_user_id_tenant_users_id_fk'),
      ('email_templates', 'email_templates_tenant_id_fkey', 'email_templates_tenant_id_tenants_id_fk'),
      ('equipment_items', 'equipment_items_category_id_fkey', 'equipment_items_category_id_equipment_categories_id_fk'),
      ('flow_gates', 'flow_gates_assignee_tenant_user_id_fkey', 'flow_gates_assignee_tenant_user_id_tenant_users_id_fk'),
      ('flow_gates', 'flow_gates_decided_by_tenant_user_id_fkey', 'flow_gates_decided_by_tenant_user_id_tenant_users_id_fk'),
      ('flow_gates', 'flow_gates_flow_id_fkey', 'flow_gates_flow_id_form_automations_id_fk'),
      ('flow_gates', 'flow_gates_tenant_id_fkey', 'flow_gates_tenant_id_tenants_id_fk'),
      ('integration_export_log', 'integration_export_log_tenant_id_fkey', 'integration_export_log_tenant_id_tenants_id_fk'),
      ('notification_group_members', 'notification_group_members_group_id_fkey', 'notification_group_members_group_id_notification_groups_id_fk'),
      ('notification_group_members', 'notification_group_members_tenant_id_fkey', 'notification_group_members_tenant_id_tenants_id_fk'),
      ('notification_groups', 'notification_groups_tenant_id_fkey', 'notification_groups_tenant_id_tenants_id_fk'),
      ('pdf_templates', 'pdf_templates_created_by_tenant_user_id_fkey', 'pdf_templates_created_by_tenant_user_id_tenant_users_id_fk'),
      ('pdf_templates', 'pdf_templates_tenant_id_fkey', 'pdf_templates_tenant_id_tenants_id_fk'),
      ('ppe_criteria_bank_criteria', 'ppe_criteria_bank_criteria_bank_id_fkey', 'ppe_criteria_bank_criteria_bank_id_ppe_criteria_banks_id_fk'),
      ('ppe_criteria_bank_criteria', 'ppe_criteria_bank_criteria_tenant_id_fkey', 'ppe_criteria_bank_criteria_tenant_id_tenants_id_fk'),
      ('ppe_criteria_banks', 'ppe_criteria_banks_created_by_fkey', 'ppe_criteria_banks_created_by_user_id_fk'),
      ('ppe_criteria_banks', 'ppe_criteria_banks_tenant_id_fkey', 'ppe_criteria_banks_tenant_id_tenants_id_fk'),
      ('ppe_type_criteria_groups', 'ppe_type_criteria_groups_ppe_type_id_fkey', 'ppe_type_criteria_groups_ppe_type_id_ppe_types_id_fk'),
      ('ppe_type_criteria_groups', 'ppe_type_criteria_groups_tenant_id_fkey', 'ppe_type_criteria_groups_tenant_id_tenants_id_fk'),
      ('ppe_type_inspection_criteria', 'ppe_type_inspection_criteria_group_id_fkey', 'ppe_type_inspection_criteria_group_id_ppe_type_criteria_groups_'),
      ('reference_counters', 'reference_counters_tenant_id_fkey', 'reference_counters_tenant_id_tenants_id_fk'),
      ('session', 'session_impersonating_user_id_fkey', 'session_impersonating_user_id_user_id_fk'),
      ('sms_log', 'sms_log_tenant_id_fkey', 'sms_log_tenant_id_tenants_id_fk'),
      ('tenant_integrations', 'tenant_integrations_tenant_id_fkey', 'tenant_integrations_tenant_id_tenants_id_fk'),
      ('tenant_notification_policy', 'tenant_notification_policy_tenant_id_fkey', 'tenant_notification_policy_tenant_id_tenants_id_fk'),
      ('tenant_notification_settings', 'tenant_notification_settings_tenant_id_fkey', 'tenant_notification_settings_tenant_id_tenants_id_fk'),
      ('user_permission_overrides', 'user_permission_overrides_tenant_id_fkey', 'user_permission_overrides_tenant_id_tenants_id_fk'),
      ('user_permission_overrides', 'user_permission_overrides_tenant_user_id_fkey', 'user_permission_overrides_tenant_user_id_tenant_users_id_fk'),
      ('vehicle_log_settings', 'vehicle_log_settings_tenant_id_fkey', 'vehicle_log_settings_tenant_id_tenants_id_fk'),
      ('walkthrough_progress', 'walkthrough_progress_tenant_id_fkey', 'walkthrough_progress_tenant_id_tenants_id_fk'),
      ('walkthrough_progress', 'walkthrough_progress_user_id_fkey', 'walkthrough_progress_user_id_user_id_fk'),
      ('walkthrough_settings', 'walkthrough_settings_tenant_id_fkey', 'walkthrough_settings_tenant_id_tenants_id_fk')
    ) AS constraints_to_rename(table_name, old_name, new_name)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      WHERE ns.nspname = 'public'
        AND rel.relname = item.table_name
        AND con.conname = item.old_name
    ) AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      WHERE ns.nspname = 'public'
        AND rel.relname = item.table_name
        AND con.conname = item.new_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I',
        item.table_name,
        item.old_name,
        item.new_name
      );
    END IF;
  END LOOP;
END
$$;--> statement-breakpoint

-- Drizzle wraps every pending migration in one transaction, so ALTER TYPE ADD
-- VALUE cannot be followed by use of the new label anywhere in that run.
-- Rebuild the enum atomically and map the one retired state during the cast.
ALTER TABLE "compliance_dispatches" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."compliance_dispatch_status" RENAME TO "compliance_dispatch_status_legacy";--> statement-breakpoint
CREATE TYPE "public"."compliance_dispatch_status" AS ENUM ('queued','enqueued','skipped','failed');--> statement-breakpoint
ALTER TABLE "compliance_dispatches"
  ALTER COLUMN "status" TYPE "public"."compliance_dispatch_status"
  USING (
    CASE "status"::text
      WHEN 'scheduled' THEN 'queued'
      ELSE "status"::text
    END
  )::"public"."compliance_dispatch_status";--> statement-breakpoint
ALTER TABLE "compliance_dispatches" ALTER COLUMN "status" SET DEFAULT 'queued';--> statement-breakpoint
DROP TYPE "public"."compliance_dispatch_status_legacy";
