CREATE TYPE "public"."equipment_maintenance_dispatch_status" AS ENUM('queued', 'enqueued', 'failed');--> statement-breakpoint
CREATE TYPE "public"."api_idempotency_status" AS ENUM('processing', 'completed');--> statement-breakpoint
CREATE TYPE "public"."report_run_delivery_status" AS ENUM('queued', 'enqueued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."report_run_trigger" AS ENUM('scheduled', 'manual');--> statement-breakpoint
CREATE TYPE "public"."domain_event_outbox_status" AS ENUM('pending', 'publishing', 'published');--> statement-breakpoint
CREATE TABLE "attachment_upload_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"kind" "attachment_kind" NOT NULL,
	"staging_key" text NOT NULL,
	"r2_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"verification_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attachment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_maintenance_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"delivery_key" text NOT NULL,
	"status" "equipment_maintenance_dispatch_status" DEFAULT 'queued' NOT NULL,
	"entries" jsonb NOT NULL,
	"schedule_cycles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reminder_cycles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"api_key_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status" "api_idempotency_status" NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_run_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"status" "report_run_delivery_status" DEFAULT 'queued' NOT NULL,
	"email_job_id" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_event_effects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"effect_key" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_event_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"dedup_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "domain_event_outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"notification_published_at" timestamp with time zone,
	"integration_published_at" timestamp with time zone,
	"web_published_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'attachment_upload_reservations',
    'equipment_maintenance_dispatches',
    'api_idempotency_keys',
    'report_run_deliveries',
    'domain_event_effects',
    'domain_event_outbox'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tenant_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      tenant_table
    );
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "form_assignment_dispatches" ALTER COLUMN "status" SET DEFAULT 'queued';--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "dedup_key" text;--> statement-breakpoint
ALTER TABLE "flow_gates" ADD COLUMN "execution_id" uuid;--> statement-breakpoint
ALTER TABLE "flow_gates" ADD COLUMN "signature_attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "form_responses" ADD COLUMN "flow_execution_key" text;--> statement-breakpoint
ALTER TABLE "form_responses" ADD COLUMN "monitor_flow_execution_key" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "flow_execution_key" text;--> statement-breakpoint
ALTER TABLE "training_class_attendees" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "ca_complete_steps" ADD COLUMN "signature_attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "corrective_actions" ADD COLUMN "flow_execution_key" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "source_job_id" text;--> statement-breakpoint
ALTER TABLE "integration_export_log" ADD COLUMN "automation_id" uuid;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "builder_template_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inspection_records" ADD COLUMN "customer_signature_attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "training_lesson_progress" ADD COLUMN "evaluation_signature_attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "report_runs" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "report_runs" ADD COLUMN "trigger" "report_run_trigger";--> statement-breakpoint
ALTER TABLE "report_runs" ADD COLUMN "request_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD COLUMN "run_as_tenant_user_id" uuid;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD COLUMN "run_as_role_id" uuid;--> statement-breakpoint
ALTER TABLE "form_assignment_dispatches" ADD COLUMN "notification_payload" jsonb;--> statement-breakpoint
ALTER TABLE "form_assignment_dispatches" ADD COLUMN "notification_job_id" text;--> statement-breakpoint
ALTER TABLE "hazid_assessment_signatures" ADD COLUMN "signature_attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "job_title_task_acknowledgments" ADD COLUMN "signature_attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "compliance_dispatches" ADD COLUMN "alert_payload" jsonb;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD COLUMN "source_key" text;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD COLUMN "source_id" uuid;--> statement-breakpoint

-- Expand/backfill phase. Legacy contract columns remain available to the old
-- deployment until 0005 verifies the new application and external storage
-- backfills, then removes them.
DO $$
DECLARE
  backfill_table text;
BEGIN
  -- The NOLOGIN owner is intentionally NOBYPASSRLS. Temporarily removing FORCE
  -- lets that owner see rows while ordinary runtime roles remain policy-bound.
  -- Drizzle runs this migration transactionally, so an error also rolls this
  -- DDL back; FORCE is restored explicitly below before commit.
  FOREACH backfill_table IN ARRAY ARRAY[
    'ai_conversation_shares',
    'api_keys',
    'attachments',
    'compliance_dispatches',
    'compliance_obligations',
    'document_categories',
    'documents',
    'form_assignment_dispatches',
    'form_automations',
    'form_template_versions',
    'form_templates',
    'incidents',
    'integration_export_log',
    'report_definitions',
    'report_runs',
    'report_schedules',
    'role_assignments',
    'roles',
    'tenant_users',
    'training_certificates',
    'training_skill_certificates'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', backfill_table);
  END LOOP;
END $$;--> statement-breakpoint
UPDATE "form_assignment_dispatches"
SET "status" = 'enqueued'
WHERE "status"::text = 'scheduled';--> statement-breakpoint
UPDATE "compliance_obligations"
SET "source_key" = "legacy_table",
    "source_id" = "legacy_id"
WHERE "source_key" IS NULL
  AND "source_id" IS NULL
  AND ("legacy_table" IS NOT NULL OR "legacy_id" IS NOT NULL);--> statement-breakpoint

UPDATE "incidents"
SET "ems_called" = "ems_called" OR "ems_notified",
    "first_aid_given" = "first_aid_given" OR "first_aid_received",
    "hospital_name" = coalesce(nullif(btrim("hospital_name"), ''), nullif(btrim("treated_at_hospital"), '')),
    "updated_at" = now()
WHERE ("ems_notified" AND NOT "ems_called")
   OR ("first_aid_received" AND NOT "first_aid_given")
   OR (nullif(btrim("hospital_name"), '') IS NULL AND nullif(btrim("treated_at_hospital"), '') IS NOT NULL);--> statement-breakpoint

INSERT INTO "document_categories" ("tenant_id", "name", "created_at", "updated_at")
SELECT d."tenant_id", min(btrim(d."category")), now(), now()
FROM "documents" d
WHERE nullif(btrim(d."category"), '') IS NOT NULL
  AND d."category_id" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "document_categories" c
    WHERE c."tenant_id" = d."tenant_id"
      AND c."parent_id" IS NULL
      AND c."deleted_at" IS NULL
      AND lower(btrim(c."name")) = lower(btrim(d."category"))
  )
GROUP BY d."tenant_id", lower(btrim(d."category"));--> statement-breakpoint
UPDATE "documents" d
SET "category_id" = c."id",
    "updated_at" = now()
FROM "document_categories" c
WHERE d."tenant_id" = c."tenant_id"
  AND d."category_id" IS NULL
  AND nullif(btrim(d."category"), '') IS NOT NULL
  AND c."parent_id" IS NULL
  AND c."deleted_at" IS NULL
  AND lower(btrim(c."name")) = lower(btrim(d."category"));--> statement-breakpoint

CREATE OR REPLACE FUNCTION pg_temp.beaconhs_rewrite_form_schema(value jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE jsonb_typeof(value)
    WHEN 'object' THEN (
      SELECT coalesce(
        jsonb_object_agg(
          entry.key,
          CASE
            WHEN entry.key = 'type' AND entry.value = '"textarea"'::jsonb THEN '"long_text"'::jsonb
            WHEN entry.key = 'type' AND entry.value = '"calc"'::jsonb THEN '"formula"'::jsonb
            ELSE pg_temp.beaconhs_rewrite_form_schema(entry.value)
          END
        ),
        '{}'::jsonb
      )
      FROM jsonb_each(value) entry
    )
    WHEN 'array' THEN (
      SELECT coalesce(jsonb_agg(pg_temp.beaconhs_rewrite_form_schema(item.value) ORDER BY item.ordinality), '[]'::jsonb)
      FROM jsonb_array_elements(value) WITH ORDINALITY item(value, ordinality)
    )
    ELSE value
  END
$$;--> statement-breakpoint
UPDATE "form_template_versions"
SET "schema" = pg_temp.beaconhs_rewrite_form_schema("schema")
WHERE jsonb_path_exists("schema", '$.** ? (@.type == "textarea" || @.type == "calc")');--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "form_template_versions" v
    WHERE v."schema" ? 'monitor'
      AND NOT EXISTS (
        SELECT 1
        FROM "form_automations" a
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(a."graph"->'nodes', '[]'::jsonb)) node(value)
        WHERE a."template_id" = v."template_id"
          AND a."enabled" = true
          AND node.value->'data'->>'kind' = 'action'
          AND node.value->'data'->'action'->>'action' = 'start_monitored_session'
          AND (node.value->'data'->'action'->>'intervalMinutes')::numeric = (v."schema"->'monitor'->>'intervalMinutes')::numeric
          AND (node.value->'data'->'action'->>'graceMinutes')::numeric = (v."schema"->'monitor'->>'graceMinutes')::numeric
          AND nullif(node.value->'data'->'action'->>'durationMinutes', '')::numeric IS NOT DISTINCT FROM nullif(v."schema"->'monitor'->>'durationMinutes', '')::numeric
          AND node.value->'data'->'action'->>'intervalFieldKey' IS NOT DISTINCT FROM v."schema"->'monitor'->>'intervalFieldKey'
          AND node.value->'data'->'action'->>'graceFieldKey' IS NOT DISTINCT FROM v."schema"->'monitor'->>'graceFieldKey'
          AND node.value->'data'->'action'->>'durationFieldKey' IS NOT DISTINCT FROM v."schema"->'monitor'->>'durationFieldKey'
          AND coalesce((node.value->'data'->'action'->>'requireGeo')::boolean, false) = coalesce((v."schema"->'monitor'->>'requireGeo')::boolean, false)
      )
  ) THEN
    RAISE EXCEPTION 'A legacy monitored-session schema has no equivalent enabled start_monitored_session flow';
  END IF;
END $$;--> statement-breakpoint
UPDATE "form_template_versions"
SET "schema" = "schema" - 'monitor'
WHERE "schema" ? 'monitor';--> statement-breakpoint
UPDATE "form_templates"
SET "module_binding" = NULL,
    "updated_at" = now()
WHERE "module_binding" = 'hazard_assessment_app';--> statement-breakpoint

UPDATE "tenants"
SET "settings" = jsonb_set(
  "settings",
  '{trainingCredentialOutputs}',
  jsonb_build_array(
    ("settings"->'trainingCredentialDesign') || jsonb_build_object(
      'id', 'certificate',
      'name', coalesce(nullif("settings"->'trainingCredentialDesign'->>'name', ''), 'Full-size certificate'),
      'description', 'Letter PDF for personnel files, wall display, and compliance packages.',
      'format', CASE
        WHEN "settings"->'trainingCredentialDesign'->>'format' = 'wallet' THEN 'letter-landscape'
        ELSE coalesce("settings"->'trainingCredentialDesign'->>'format', 'letter-landscape')
      END,
      'enabled', true
    ),
    ("settings"->'trainingCredentialDesign') || jsonb_build_object(
      'id', 'wallet-card',
      'name', 'Wallet card',
      'description', 'Two-sided CR80 card for field verification and mobile crews.',
      'format', 'wallet',
      'enabled', true
    )
  ),
  true
)
WHERE "settings" ? 'trainingCredentialDesign'
  AND NOT ("settings" ? 'trainingCredentialOutputs');--> statement-breakpoint

WITH canonical_filters AS (
  SELECT d."id",
    CASE
      WHEN jsonb_typeof(d."custom_query"->'filtersV2') = 'object'
        THEN d."custom_query"->'filtersV2'
      WHEN jsonb_typeof(d."custom_query"->'filters') = 'array'
        THEN jsonb_build_object(
          'combinator', 'and',
          'rules', coalesce((
            SELECT jsonb_agg(
              (rule.value - 'column' - 'operator') || jsonb_build_object(
                'field', coalesce(rule.value->>'field', rule.value->>'column'),
                'op', coalesce(rule.value->>'op', rule.value->>'operator')
              )
              ORDER BY rule.ordinality
            )
            FROM jsonb_array_elements(d."custom_query"->'filters') WITH ORDINALITY rule(value, ordinality)
          ), '[]'::jsonb)
        )
      ELSE NULL
    END AS filters
  FROM "report_definitions" d
  WHERE d."custom_query" IS NOT NULL
)
UPDATE "report_definitions" d
SET "custom_query" = jsonb_set(
  jsonb_set(d."custom_query", '{filters}', canonical_filters.filters, true),
  '{filtersV2}', canonical_filters.filters, true
),
    "updated_at" = now()
FROM canonical_filters
WHERE d."id" = canonical_filters."id"
  AND canonical_filters.filters IS NOT NULL;--> statement-breakpoint
UPDATE "report_definitions"
SET "custom_query" = jsonb_set("custom_query", '{entity}', '"ppe_items"'::jsonb, false),
    "updated_at" = now()
WHERE "custom_query"->>'entity' = 'ppe';--> statement-breakpoint
UPDATE "report_definitions"
SET "slug" = CASE "slug"
  WHEN 'legacy_training_cert_matrix' THEN 'training_certificate_matrix'
  WHEN 'legacy_training_certificates' THEN 'training_certificates'
  WHEN 'legacy_training_expired' THEN 'training_expired_upcoming'
  WHEN 'legacy_training_missing' THEN 'training_missing'
  WHEN 'legacy_skills_matrix' THEN 'skills_matrix'
  WHEN 'legacy_skills_expired' THEN 'skills_expired_upcoming'
  WHEN 'legacy_skills_cwb' THEN 'skills_cwb'
  WHEN 'legacy_corrective_list' THEN 'corrective_actions_list'
  WHEN 'legacy_ppe_list' THEN 'ppe_list'
  WHEN 'legacy_ppe_expired' THEN 'ppe_expired_upcoming'
  WHEN 'legacy_vehicle_log_monthly' THEN 'vehicle_log_monthly'
  WHEN 'legacy_equipment_fleet' THEN 'equipment_fleet'
  WHEN 'legacy_equipment_inspections' THEN 'equipment_inspections'
  WHEN 'legacy_equipment_oilchange' THEN 'equipment_oil_change_due'
  ELSE "slug"
END,
"updated_at" = now()
WHERE "slug" LIKE 'legacy\_%' ESCAPE '\';--> statement-breakpoint
UPDATE "report_definitions"
SET "custom_query" = '{
  "entity": "equipment_fleet",
  "mode": "rows",
  "columns": [
    "asset_tag",
    "name",
    "equipment_type",
    "site_name",
    "holder_name",
    "last_inspection_on",
    "next_inspection_due"
  ],
  "filters": {
    "combinator": "and",
    "rules": [
      { "field": "next_inspection_due", "op": "due_within_days", "value": 30 }
    ]
  },
  "filtersV2": {
    "combinator": "and",
    "rules": [
      { "field": "next_inspection_due", "op": "due_within_days", "value": 30 }
    ]
  },
  "sort": { "column": "next_inspection_due", "direction": "asc" },
  "limit": 5000
}'::jsonb,
    "updated_at" = now()
WHERE "slug" = 'equipment_inspections';--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "report_schedules" s
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT tu."id") AS candidates
      FROM "tenant_users" tu
      JOIN "role_assignments" ra
        ON ra."tenant_id" = tu."tenant_id" AND ra."tenant_user_id" = tu."id"
      JOIN "roles" r
        ON r."tenant_id" = ra."tenant_id" AND r."id" = ra."role_id"
      WHERE tu."tenant_id" = s."tenant_id"
        AND tu."status" = 'active'
        AND r."key" = 'tenant_admin'
        AND r."is_built_in" = true
    ) candidate ON true
    WHERE candidate.candidates <> 1
  ) THEN
    RAISE EXCEPTION 'Each legacy report schedule must resolve to exactly one active tenant administrator';
  END IF;
END $$;--> statement-breakpoint
WITH schedule_actor AS (
  SELECT DISTINCT ON (s."id")
    s."id" AS schedule_id,
    tu."id" AS tenant_user_id,
    r."id" AS role_id
  FROM "report_schedules" s
  JOIN "tenant_users" tu
    ON tu."tenant_id" = s."tenant_id" AND tu."status" = 'active'
  JOIN "role_assignments" ra
    ON ra."tenant_id" = tu."tenant_id" AND ra."tenant_user_id" = tu."id"
  JOIN "roles" r
    ON r."tenant_id" = ra."tenant_id" AND r."id" = ra."role_id"
  WHERE r."key" = 'tenant_admin' AND r."is_built_in" = true
  ORDER BY s."id", tu."created_at", tu."id"
)
UPDATE "report_schedules" s
SET "run_as_tenant_user_id" = schedule_actor.tenant_user_id,
    "run_as_role_id" = schedule_actor.role_id,
    "updated_at" = now()
FROM schedule_actor
WHERE s."id" = schedule_actor.schedule_id
  AND s."run_as_tenant_user_id" IS NULL;--> statement-breakpoint
UPDATE "report_runs" run
SET "scheduled_for" = run."started_at",
    "trigger" = CASE
      WHEN schedule."active" = false AND schedule."next_run_at" IS NULL THEN 'manual'::"report_run_trigger"
      ELSE 'scheduled'::"report_run_trigger"
    END,
    "request_snapshot" = jsonb_build_object(
      'scheduleName', schedule."name",
      'definition', jsonb_build_object(
        'id', definition."id",
        'slug', definition."slug",
        'name', definition."name",
        'queryKind', definition."query_kind",
        'customQuery', definition."custom_query",
        'layout', definition."layout"
      ),
      'filters', schedule."filters",
      'recipientUserIds', schedule."recipient_user_ids",
      'recipientEmails', schedule."recipient_emails",
      'runAsTenantUserId', schedule."run_as_tenant_user_id",
      'runAsRoleId', schedule."run_as_role_id"
    ),
    "updated_at" = now()
FROM "report_schedules" schedule
JOIN "report_definitions" definition ON definition."id" = schedule."definition_id"
WHERE run."schedule_id" = schedule."id"
  AND (run."scheduled_for" IS NULL OR run."trigger" IS NULL OR run."request_snapshot" IS NULL);--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "integration_export_log") THEN
    RAISE EXCEPTION 'Legacy integration export rows cannot be mapped safely to automation UUIDs';
  END IF;
  IF EXISTS (SELECT 1 FROM "role_assignments" WHERE "scope" ? 'divisionIds') THEN
    RAISE EXCEPTION 'Retired role scope divisionIds remain';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "form_assignment_dispatches" WHERE "status" = 'scheduled'
  ) OR EXISTS (
    SELECT 1 FROM "compliance_dispatches" WHERE "status"::text = 'scheduled'
  ) THEN
    RAISE EXCEPTION 'Retired scheduled dispatch status remains';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "form_template_versions"
    WHERE jsonb_path_exists("schema", '$.** ? (@.type == "textarea" || @.type == "calc")')
       OR "schema" ? 'monitor'
  ) THEN
    RAISE EXCEPTION 'Retired form schema fields remain after canonicalization';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "documents"
    WHERE nullif(btrim("category"), '') IS NOT NULL AND "category_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Document category text could not be mapped to a canonical category';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "documents" d
    JOIN "document_categories" c ON c."id" = d."category_id"
    WHERE d."tenant_id" <> c."tenant_id"
  ) THEN
    RAISE EXCEPTION 'A document category relationship crosses tenants';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "report_schedules"
    WHERE "run_as_tenant_user_id" IS NULL
  ) OR EXISTS (
    SELECT 1 FROM "report_runs"
    WHERE "scheduled_for" IS NULL OR "trigger" IS NULL OR "request_snapshot" IS NULL
  ) THEN
    RAISE EXCEPTION 'Report schedule/run backfill is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "report_runs" GROUP BY "schedule_id", "scheduled_for" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate report schedule occurrences remain';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "attachments" GROUP BY "r2_key" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate attachment object keys remain';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "training_certificates" GROUP BY "record_id" HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "training_certificates" GROUP BY "verify_token" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate training certificate identity remains';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "training_skill_certificates" GROUP BY "skill_assignment_id" HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "training_skill_certificates" GROUP BY "verify_token" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate skill certificate identity remains';
  END IF;
  IF EXISTS (SELECT 1 FROM "api_keys" GROUP BY "key_hash" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate API key hashes remain';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "form_assignment_dispatches" GROUP BY "assignment_id", "occurred_at" HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "compliance_dispatches" GROUP BY "obligation_id", "occurred_at" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate durable dispatch occurrences remain';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "ai_conversation_shares"
    WHERE NOT (("target_type" = 'user' AND "target_user_id" IS NOT NULL AND "target_role_id" IS NULL)
      OR ("target_type" = 'role' AND "target_role_id" IS NOT NULL AND "target_user_id" IS NULL))
  ) THEN
    RAISE EXCEPTION 'Invalid AI conversation share target remains';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "ai_conversation_shares"
    WHERE "target_type" = 'user'
    GROUP BY "tenant_id", "conversation_id", "target_user_id" HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "ai_conversation_shares"
    WHERE "target_type" = 'role'
    GROUP BY "tenant_id", "conversation_id", "target_role_id" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate AI conversation shares remain';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "document_categories"
    WHERE "deleted_at" IS NULL AND nullif(btrim("name"), '') IS NULL
  ) OR EXISTS (
    SELECT 1 FROM "document_categories" WHERE "id" = "parent_id"
  ) OR EXISTS (
    SELECT 1
    FROM "document_categories" child
    JOIN "document_categories" parent ON parent."id" = child."parent_id"
    WHERE child."tenant_id" <> parent."tenant_id"
  ) OR EXISTS (
    SELECT 1 FROM "document_categories"
    WHERE "deleted_at" IS NULL
    GROUP BY "tenant_id", coalesce("parent_id"::text, ''), lower(btrim("name"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Document category tree invariant failed';
  END IF;
END $$;--> statement-breakpoint

DO $$
DECLARE
  backfill_table text;
BEGIN
  FOREACH backfill_table IN ARRAY ARRAY[
    'ai_conversation_shares',
    'api_keys',
    'attachments',
    'compliance_dispatches',
    'compliance_obligations',
    'document_categories',
    'documents',
    'form_assignment_dispatches',
    'form_automations',
    'form_template_versions',
    'form_templates',
    'incidents',
    'integration_export_log',
    'report_definitions',
    'report_runs',
    'report_schedules',
    'role_assignments',
    'roles',
    'tenant_users',
    'training_certificates',
    'training_skill_certificates'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', backfill_table);
  END LOOP;
END $$;--> statement-breakpoint

-- Parent uniqueness must exist before the composite foreign keys below.
CREATE UNIQUE INDEX "tenant_users_tenant_id_id_ux" ON "tenant_users" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_tenant_id_id_ux" ON "roles" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_tenant_id_id_ux" ON "attachments" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_conversations_tenant_id_id_ux" ON "ai_conversations" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_integrations_tenant_id_id_ux" ON "tenant_integrations" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_tenant_id_id_ux" ON "api_keys" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_runs_tenant_id_id_ux" ON "report_runs" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_schedules_tenant_id_id_ux" ON "report_schedules" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_event_outbox_tenant_id_id_ux" ON "domain_event_outbox" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "attachment_upload_reservations" ADD CONSTRAINT "attachment_upload_reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_upload_reservations" ADD CONSTRAINT "attachment_upload_reservations_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_upload_reservations" ADD CONSTRAINT "attachment_upload_reservations_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_maintenance_dispatches" ADD CONSTRAINT "equipment_maintenance_dispatches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_idempotency_keys" ADD CONSTRAINT "api_idempotency_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_idempotency_keys" ADD CONSTRAINT "api_idempotency_keys_tenant_api_key_fk" FOREIGN KEY ("tenant_id","api_key_id") REFERENCES "public"."api_keys"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_run_deliveries" ADD CONSTRAINT "report_run_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_run_deliveries" ADD CONSTRAINT "report_run_deliveries_tenant_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."report_runs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_event_effects" ADD CONSTRAINT "domain_event_effects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_event_effects" ADD CONSTRAINT "domain_event_effects_tenant_event_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."domain_event_outbox"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_event_outbox" ADD CONSTRAINT "domain_event_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_upload_reservations_tenant_expiry_idx" ON "attachment_upload_reservations" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE INDEX "attachment_upload_reservations_requested_by_idx" ON "attachment_upload_reservations" USING btree ("tenant_id","requested_by");--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_upload_reservations_staging_key_ux" ON "attachment_upload_reservations" USING btree ("staging_key");--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_upload_reservations_r2_key_ux" ON "attachment_upload_reservations" USING btree ("r2_key");--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_upload_reservations_attachment_ux" ON "attachment_upload_reservations" USING btree ("attachment_id");--> statement-breakpoint
CREATE INDEX "equipment_maintenance_dispatches_tenant_status_idx" ON "equipment_maintenance_dispatches" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_maintenance_dispatches_tenant_delivery_ux" ON "equipment_maintenance_dispatches" USING btree ("tenant_id","delivery_key");--> statement-breakpoint
CREATE UNIQUE INDEX "api_idempotency_keys_api_key_key_ux" ON "api_idempotency_keys" USING btree ("api_key_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "api_idempotency_keys_tenant_expiry_idx" ON "api_idempotency_keys" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "report_run_deliveries_run_recipient_ux" ON "report_run_deliveries" USING btree ("run_id","recipient_email");--> statement-breakpoint
CREATE INDEX "report_run_deliveries_tenant_idx" ON "report_run_deliveries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "report_run_deliveries_status_idx" ON "report_run_deliveries" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_event_effects_event_effect_ux" ON "domain_event_effects" USING btree ("tenant_id","event_id","effect_key");--> statement-breakpoint
CREATE INDEX "domain_event_effects_event_idx" ON "domain_event_effects" USING btree ("tenant_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_event_outbox_tenant_dedup_ux" ON "domain_event_outbox" USING btree ("tenant_id","dedup_key");--> statement-breakpoint
CREATE INDEX "domain_event_outbox_status_available_idx" ON "domain_event_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "domain_event_outbox_status_claimed_idx" ON "domain_event_outbox" USING btree ("status","claimed_at");--> statement-breakpoint
CREATE INDEX "domain_event_outbox_tenant_subject_idx" ON "domain_event_outbox" USING btree ("tenant_id","subject_id","created_at");--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_tenant_user_fk" FOREIGN KEY ("tenant_id","tenant_user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_tenant_role_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."roles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_tenant_user_fk" FOREIGN KEY ("tenant_id","tenant_user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_photo_attachment_id_attachments_id_fk" FOREIGN KEY ("photo_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_signature_attachment_id_attachments_id_fk" FOREIGN KEY ("signature_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_gates" ADD CONSTRAINT "flow_gates_signature_attachment_id_attachments_id_fk" FOREIGN KEY ("signature_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response_steps" ADD CONSTRAINT "form_response_steps_signature_attachment_id_attachments_id_fk" FOREIGN KEY ("signature_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_pdf_attachment_id_attachments_id_fk" FOREIGN KEY ("pdf_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversation_shares" ADD CONSTRAINT "ai_conversation_shares_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."ai_conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversation_shares" ADD CONSTRAINT "ai_conversation_shares_tenant_role_fk" FOREIGN KEY ("tenant_id","target_role_id") REFERENCES "public"."roles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversation_shares" ADD CONSTRAINT "ai_conversation_shares_tenant_user_fk" FOREIGN KEY ("tenant_id","target_user_id") REFERENCES "public"."tenant_users"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."ai_conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_attachments" ADD CONSTRAINT "incident_attachments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_certificates" ADD CONSTRAINT "training_certificates_pdf_attachment_id_attachments_id_fk" FOREIGN KEY ("pdf_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_class_attendees" ADD CONSTRAINT "training_class_attendees_signature_attachment_id_attachments_id_fk" FOREIGN KEY ("signature_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_certificate_attachment_id_attachments_id_fk" FOREIGN KEY ("certificate_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_photo_attachment_id_attachments_id_fk" FOREIGN KEY ("photo_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_manual_attachment_id_attachments_id_fk" FOREIGN KEY ("manual_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspection_record_attachments" ADD CONSTRAINT "equipment_inspection_record_attachments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_issues" ADD CONSTRAINT "ppe_issues_receipt_signature_attachment_id_attachments_id_fk" FOREIGN KEY ("receipt_signature_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgments" ADD CONSTRAINT "document_acknowledgments_signature_attachment_id_attachments_id_fk" FOREIGN KEY ("signature_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_content_attachment_id_attachments_id_fk" FOREIGN KEY ("content_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_docx_attachment_id_attachments_id_fk" FOREIGN KEY ("docx_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_pdf_attachment_id_attachments_id_fk" FOREIGN KEY ("pdf_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_source_attachment_id_attachments_id_fk" FOREIGN KEY ("source_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ca_complete_steps" ADD CONSTRAINT "ca_complete_steps_signature_attachment_id_attachments_id_fk" FOREIGN KEY ("signature_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ca_photos" ADD CONSTRAINT "ca_photos_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_export_log" ADD CONSTRAINT "integration_export_log_tenant_automation_fk" FOREIGN KEY ("tenant_id","automation_id") REFERENCES "public"."tenant_integrations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record_attachments" ADD CONSTRAINT "inspection_record_attachments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_records" ADD CONSTRAINT "inspection_records_customer_signature_attachment_id_attachments_id_fk" FOREIGN KEY ("customer_signature_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_skill_certificates" ADD CONSTRAINT "training_skill_certificates_pdf_attachment_id_attachments_id_fk" FOREIGN KEY ("pdf_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_content_items" ADD CONSTRAINT "training_content_items_source_attachment_id_attachments_id_fk" FOREIGN KEY ("source_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_content_items" ADD CONSTRAINT "training_content_items_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_lesson_progress" ADD CONSTRAINT "training_lesson_progress_evaluation_signature_attachment_id_attachments_id_fk" FOREIGN KEY ("evaluation_signature_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_lessons" ADD CONSTRAINT "training_lessons_source_attachment_id_attachments_id_fk" FOREIGN KEY ("source_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_lessons" ADD CONSTRAINT "training_lessons_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_tenant_schedule_fk" FOREIGN KEY ("tenant_id","schedule_id") REFERENCES "public"."report_schedules"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_tenant_run_as_user_fk" FOREIGN KEY ("tenant_id","run_as_tenant_user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_tenant_run_as_role_fk" FOREIGN KEY ("tenant_id","run_as_role_id") REFERENCES "public"."roles"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_references" ADD CONSTRAINT "document_references_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazid_assessment_signatures" ADD CONSTRAINT "hazid_assessment_signatures_signature_attachment_id_attachments_id_fk" FOREIGN KEY ("signature_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_photos" ADD CONSTRAINT "journal_entry_photos_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_title_task_acknowledgments" ADD CONSTRAINT "job_title_task_acknowledgments_signature_attachment_id_attachments_id_fk" FOREIGN KEY ("signature_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_dashboard_layouts" ADD CONSTRAINT "role_dashboard_layouts_tenant_role_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."roles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DO $$
DECLARE
  ref record;
  delete_clause text;
BEGIN
  FOR ref IN
    SELECT * FROM (VALUES
      ('attachment_upload_reservations', 'attachment_id', 'set null', 'att_tenant_attachment_upload_reservations_attachmen_66ef871a'),
      ('ca_complete_steps', 'signature_attachment_id', 'set null', 'att_tenant_ca_complete_steps_signature_attachment_i_7ac91220'),
      ('ca_photos', 'attachment_id', 'cascade', 'att_tenant_ca_photos_attachment_id_8d52d64f'),
      ('document_acknowledgments', 'signature_attachment_id', 'set null', 'att_tenant_document_acknowledgments_signature_attac_8d4dd74c'),
      ('document_references', 'attachment_id', 'set null', 'att_tenant_document_references_attachment_id_aa9c82e3'),
      ('document_versions', 'content_attachment_id', 'set null', 'att_tenant_document_versions_content_attachment_id_fbe2121a'),
      ('document_versions', 'docx_attachment_id', 'set null', 'att_tenant_document_versions_docx_attachment_id_b9205573'),
      ('document_versions', 'pdf_attachment_id', 'set null', 'att_tenant_document_versions_pdf_attachment_id_d0ab2091'),
      ('documents', 'source_attachment_id', 'set null', 'att_tenant_documents_source_attachment_id_ffee7c97'),
      ('equipment_inspection_record_attachments', 'attachment_id', 'cascade', 'att_tenant_equipment_inspection_record_attachments__500ac65b'),
      ('equipment_items', 'manual_attachment_id', 'set null', 'att_tenant_equipment_items_manual_attachment_id_7d1906f3'),
      ('equipment_items', 'photo_attachment_id', 'set null', 'att_tenant_equipment_items_photo_attachment_id_f21b0693'),
      ('equipment_log_entries', 'attachment_id', 'set null', 'att_tenant_equipment_log_entries_attachment_id_d6cf86b1'),
      ('flow_gates', 'signature_attachment_id', 'set null', 'att_tenant_flow_gates_signature_attachment_id_7b0208cb'),
      ('form_response_steps', 'signature_attachment_id', 'set null', 'att_tenant_form_response_steps_signature_attachment_c9af0c56'),
      ('form_responses', 'pdf_attachment_id', 'set null', 'att_tenant_form_responses_pdf_attachment_id_77a27d75'),
      ('hazid_assessment_photos', 'attachment_id', 'cascade', 'att_tenant_hazid_assessment_photos_attachment_id_e68dd69c'),
      ('hazid_assessment_signatures', 'signature_attachment_id', 'set null', 'att_tenant_hazid_assessment_signatures_signature_at_3d4c2f1b'),
      ('hazid_hazards', 'photo_attachment_id', 'set null', 'att_tenant_hazid_hazards_photo_attachment_id_4fc40ddc'),
      ('incident_attachments', 'attachment_id', 'cascade', 'att_tenant_incident_attachments_attachment_id_c4235b2a'),
      ('inspection_record_attachments', 'attachment_id', 'cascade', 'att_tenant_inspection_record_attachments_attachment_b7a018cc'),
      ('inspection_records', 'customer_signature_attachment_id', 'set null', 'att_tenant_inspection_records_customer_signature_at_26e23f62'),
      ('job_title_task_acknowledgments', 'signature_attachment_id', 'set null', 'att_tenant_job_title_task_acknowledgments_signature_c4cbdd57'),
      ('journal_entry_photos', 'attachment_id', 'cascade', 'att_tenant_journal_entry_photos_attachment_id_320c6565'),
      ('people', 'photo_attachment_id', 'set null', 'att_tenant_people_photo_attachment_id_0d0df239'),
      ('people', 'signature_attachment_id', 'set null', 'att_tenant_people_signature_attachment_id_b1274863'),
      ('person_files', 'attachment_id', 'set null', 'att_tenant_person_files_attachment_id_0e1a4b40'),
      ('ppe_annual_records', 'certificate_attachment_id', 'set null', 'att_tenant_ppe_annual_records_certificate_attachmen_da29f9c3'),
      ('ppe_issues', 'receipt_signature_attachment_id', 'set null', 'att_tenant_ppe_issues_receipt_signature_attachment__ac3db527'),
      ('report_runs', 'pdf_attachment_id', 'set null', 'att_tenant_report_runs_pdf_attachment_id_306d4627'),
      ('training_certificates', 'pdf_attachment_id', 'set null', 'att_tenant_training_certificates_pdf_attachment_id_f095740d'),
      ('training_class_attendees', 'signature_attachment_id', 'set null', 'att_tenant_training_class_attendees_signature_attac_b66d1fc9'),
      ('training_content_items', 'attachment_id', 'set null', 'att_tenant_training_content_items_attachment_id_687a36fa'),
      ('training_content_items', 'source_attachment_id', 'set null', 'att_tenant_training_content_items_source_attachment_13fe424a'),
      ('training_course_files', 'attachment_id', 'set null', 'att_tenant_training_course_files_attachment_id_9d69a56d'),
      ('training_lesson_progress', 'evaluation_signature_attachment_id', 'set null', 'att_tenant_training_lesson_progress_evaluation_sign_36ccded4'),
      ('training_lessons', 'attachment_id', 'set null', 'att_tenant_training_lessons_attachment_id_cdc65bf9'),
      ('training_lessons', 'source_attachment_id', 'set null', 'att_tenant_training_lessons_source_attachment_id_efa446df'),
      ('training_records', 'certificate_attachment_id', 'set null', 'att_tenant_training_records_certificate_attachment__0ad1cd4e'),
      ('training_skill_assignment_files', 'attachment_id', 'set null', 'att_tenant_training_skill_assignment_files_attachme_ad294ddf'),
      ('training_skill_assignments', 'evidence_attachment_id', 'set null', 'att_tenant_training_skill_assignments_evidence_atta_02d0c204'),
      ('training_skill_certificates', 'pdf_attachment_id', 'set null', 'att_tenant_training_skill_certificates_pdf_attachme_6c0034f7')
    ) AS refs(table_name, column_name, delete_action, constraint_name)
  LOOP
    delete_clause := CASE ref.delete_action
      WHEN 'cascade' THEN 'ON DELETE CASCADE'
      ELSE format('ON DELETE SET NULL (%I)', ref.column_name)
    END;
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id, %I) REFERENCES attachments (tenant_id, id) %s NOT VALID',
      ref.table_name,
      ref.constraint_name,
      ref.column_name,
      delete_clause
    );
    EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', ref.table_name, ref.constraint_name);
  END LOOP;
END $$;--> statement-breakpoint
-- The validated composite keys above supersede every simple attachment key.
-- Drop the weaker constraints so ORM metadata and the physical schema expose
-- one unambiguous tenant-safe relationship per attachment column.
ALTER TABLE "attachment_upload_reservations" DROP CONSTRAINT "attachment_upload_reservations_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "ca_complete_steps" DROP CONSTRAINT "ca_complete_steps_signature_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "ca_photos" DROP CONSTRAINT "ca_photos_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "document_acknowledgments" DROP CONSTRAINT "document_acknowledgments_signature_attachment_id_attachments_id";--> statement-breakpoint
ALTER TABLE "document_references" DROP CONSTRAINT "document_references_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "document_versions" DROP CONSTRAINT "document_versions_content_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "document_versions" DROP CONSTRAINT "document_versions_docx_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "document_versions" DROP CONSTRAINT "document_versions_pdf_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_source_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "equipment_inspection_record_attachments" DROP CONSTRAINT "equipment_inspection_record_attachments_attachment_id_attachmen";--> statement-breakpoint
ALTER TABLE "equipment_items" DROP CONSTRAINT "equipment_items_manual_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "equipment_items" DROP CONSTRAINT "equipment_items_photo_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "equipment_log_entries" DROP CONSTRAINT "equipment_log_entries_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "flow_gates" DROP CONSTRAINT "flow_gates_signature_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "form_response_steps" DROP CONSTRAINT "form_response_steps_signature_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "form_responses" DROP CONSTRAINT "form_responses_pdf_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_photos" DROP CONSTRAINT "hazid_assessment_photos_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_signatures" DROP CONSTRAINT "hazid_assessment_signatures_signature_attachment_id_attachments";--> statement-breakpoint
ALTER TABLE "hazid_hazards" DROP CONSTRAINT "hazid_hazards_photo_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "incident_attachments" DROP CONSTRAINT "incident_attachments_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "inspection_record_attachments" DROP CONSTRAINT "inspection_record_attachments_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "inspection_records" DROP CONSTRAINT "inspection_records_customer_signature_attachment_id_attachments";--> statement-breakpoint
ALTER TABLE "job_title_task_acknowledgments" DROP CONSTRAINT "job_title_task_acknowledgments_signature_attachment_id_attachme";--> statement-breakpoint
ALTER TABLE "journal_entry_photos" DROP CONSTRAINT "journal_entry_photos_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "people" DROP CONSTRAINT "people_photo_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "people" DROP CONSTRAINT "people_signature_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "person_files" DROP CONSTRAINT "person_files_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "ppe_annual_records" DROP CONSTRAINT "ppe_annual_records_certificate_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "ppe_issues" DROP CONSTRAINT "ppe_issues_receipt_signature_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "report_runs" DROP CONSTRAINT "report_runs_pdf_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "training_certificates" DROP CONSTRAINT "training_certificates_pdf_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "training_class_attendees" DROP CONSTRAINT "training_class_attendees_signature_attachment_id_attachments_id";--> statement-breakpoint
ALTER TABLE "training_content_items" DROP CONSTRAINT "training_content_items_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "training_content_items" DROP CONSTRAINT "training_content_items_source_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "training_course_files" DROP CONSTRAINT "training_course_files_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "training_lesson_progress" DROP CONSTRAINT "training_lesson_progress_evaluation_signature_attachment_id_att";--> statement-breakpoint
ALTER TABLE "training_lessons" DROP CONSTRAINT "training_lessons_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "training_lessons" DROP CONSTRAINT "training_lessons_source_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "training_records" DROP CONSTRAINT "training_records_certificate_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "training_skill_assignment_files" DROP CONSTRAINT "training_skill_assignment_files_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "training_skill_assignments" DROP CONSTRAINT "training_skill_assignments_evidence_attachment_id_attachments_i";--> statement-breakpoint
ALTER TABLE "training_skill_certificates" DROP CONSTRAINT "training_skill_certificates_pdf_attachment_id_attachments_id_fk";--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_tenant_dedup_ux" ON "audit_log" USING btree ("tenant_id","dedup_key");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_r2_key_ux" ON "attachments" USING btree ("r2_key");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_gates_execution_ux" ON "flow_gates" USING btree ("tenant_id","execution_id","flow_id","node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_responses_flow_execution_ux" ON "form_responses" USING btree ("tenant_id","flow_execution_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_conversation_shares_user_ux" ON "ai_conversation_shares" USING btree ("tenant_id","conversation_id","target_user_id") WHERE "ai_conversation_shares"."target_type" = 'user';--> statement-breakpoint
CREATE UNIQUE INDEX "ai_conversation_shares_role_ux" ON "ai_conversation_shares" USING btree ("tenant_id","conversation_id","target_role_id") WHERE "ai_conversation_shares"."target_type" = 'role';--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_flow_execution_ux" ON "incidents" USING btree ("tenant_id","flow_execution_key");--> statement-breakpoint
CREATE UNIQUE INDEX "training_certificates_record_id_ux" ON "training_certificates" USING btree ("record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_certificates_verify_token_ux" ON "training_certificates" USING btree ("verify_token");--> statement-breakpoint
CREATE UNIQUE INDEX "corrective_actions_flow_execution_ux" ON "corrective_actions" USING btree ("tenant_id","flow_execution_key");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_source_job_user_ux" ON "notifications" USING btree ("tenant_id","source_job_id","user_id");--> statement-breakpoint
CREATE INDEX "integration_export_log_automation_idx" ON "integration_export_log" USING btree ("tenant_id","automation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_ux" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "training_skill_certificates_skill_assignment_id_ux" ON "training_skill_certificates" USING btree ("skill_assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_skill_certificates_verify_token_ux" ON "training_skill_certificates" USING btree ("verify_token");--> statement-breakpoint
CREATE UNIQUE INDEX "report_definitions_builtin_slug_ux" ON "report_definitions" USING btree ("slug") WHERE "report_definitions"."tenant_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_definitions_tenant_slug_ux" ON "report_definitions" USING btree ("tenant_id","slug") WHERE "report_definitions"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_runs_schedule_occurrence_ux" ON "report_runs" USING btree ("schedule_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "report_schedules_run_as_tenant_user_idx" ON "report_schedules" USING btree ("run_as_tenant_user_id");--> statement-breakpoint
CREATE INDEX "report_schedules_run_as_role_idx" ON "report_schedules" USING btree ("run_as_role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_assignment_dispatches_assignment_occurrence_ux" ON "form_assignment_dispatches" USING btree ("assignment_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_categories_active_parent_name_ux" ON "document_categories" USING btree ("tenant_id",coalesce("parent_id"::text, ''),lower(btrim("name"))) WHERE "document_categories"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_dispatches_obligation_occurrence_ux" ON "compliance_dispatches" USING btree ("obligation_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_obligations_source_ux" ON "compliance_obligations" USING btree ("tenant_id","source_key","source_id");--> statement-breakpoint
ALTER TABLE "ai_conversation_shares" ADD CONSTRAINT "ai_conversation_shares_target_shape_ck" CHECK (("ai_conversation_shares"."target_type" = 'user' AND "ai_conversation_shares"."target_user_id" IS NOT NULL AND "ai_conversation_shares"."target_role_id" IS NULL)
        OR ("ai_conversation_shares"."target_type" = 'role' AND "ai_conversation_shares"."target_role_id" IS NOT NULL AND "ai_conversation_shares"."target_user_id" IS NULL));
--> statement-breakpoint

-- Tenant-owned actor and routing relationships are composite-only. These
-- constraints were validated against a fresh clone before the redundant
-- single-column foreign keys were removed.
CREATE INDEX "form_responses_submitted_by_idx" ON "form_responses" USING btree ("tenant_id","submitted_by");--> statement-breakpoint
CREATE INDEX "form_responses_locked_by_idx" ON "form_responses" USING btree ("tenant_id","locked_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "form_response_checkins_by_user_idx" ON "form_response_checkins" USING btree ("tenant_id","by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "form_response_steps_assignee_idx" ON "form_response_steps" USING btree ("tenant_id","assignee_tenant_user_id");--> statement-breakpoint
CREATE INDEX "form_response_steps_signed_by_idx" ON "form_response_steps" USING btree ("tenant_id","signed_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "form_response_steps_rejected_by_idx" ON "form_response_steps" USING btree ("tenant_id","rejected_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "form_response_comments_author_idx" ON "form_response_comments" USING btree ("tenant_id","author_tenant_user_id");--> statement-breakpoint
CREATE INDEX "flow_gates_decided_by_idx" ON "flow_gates" USING btree ("tenant_id","decided_by_tenant_user_id");--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_tenant_submitted_by_fk" FOREIGN KEY ("tenant_id","submitted_by") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_responses" VALIDATE CONSTRAINT "form_responses_tenant_submitted_by_fk";--> statement-breakpoint
ALTER TABLE "form_responses" DROP CONSTRAINT "form_responses_submitted_by_tenant_users_id_fk";--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_tenant_locked_by_fk" FOREIGN KEY ("tenant_id","locked_by_tenant_user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_responses" VALIDATE CONSTRAINT "form_responses_tenant_locked_by_fk";--> statement-breakpoint
ALTER TABLE "form_responses" DROP CONSTRAINT "form_responses_locked_by_tenant_user_id_tenant_users_id_fk";--> statement-breakpoint
ALTER TABLE "form_response_checkins" ADD CONSTRAINT "form_response_checkins_tenant_by_user_fk" FOREIGN KEY ("tenant_id","by_tenant_user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_response_checkins" VALIDATE CONSTRAINT "form_response_checkins_tenant_by_user_fk";--> statement-breakpoint
ALTER TABLE "form_response_checkins" DROP CONSTRAINT "form_response_checkins_by_tenant_user_id_tenant_users_id_fk";--> statement-breakpoint
ALTER TABLE "form_response_steps" ADD CONSTRAINT "form_response_steps_tenant_assignee_fk" FOREIGN KEY ("tenant_id","assignee_tenant_user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_response_steps" VALIDATE CONSTRAINT "form_response_steps_tenant_assignee_fk";--> statement-breakpoint
ALTER TABLE "form_response_steps" DROP CONSTRAINT "form_response_steps_assignee_tenant_user_id_tenant_users_id_fk";--> statement-breakpoint
ALTER TABLE "form_response_steps" ADD CONSTRAINT "form_response_steps_tenant_signed_by_fk" FOREIGN KEY ("tenant_id","signed_by_tenant_user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_response_steps" VALIDATE CONSTRAINT "form_response_steps_tenant_signed_by_fk";--> statement-breakpoint
ALTER TABLE "form_response_steps" DROP CONSTRAINT "form_response_steps_signed_by_tenant_user_id_tenant_users_id_fk";--> statement-breakpoint
ALTER TABLE "form_response_steps" ADD CONSTRAINT "form_response_steps_tenant_rejected_by_fk" FOREIGN KEY ("tenant_id","rejected_by_tenant_user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_response_steps" VALIDATE CONSTRAINT "form_response_steps_tenant_rejected_by_fk";--> statement-breakpoint
ALTER TABLE "form_response_steps" DROP CONSTRAINT "form_response_steps_rejected_by_tenant_user_id_tenant_users_id_";--> statement-breakpoint
ALTER TABLE "form_response_comments" ADD CONSTRAINT "form_response_comments_tenant_author_fk" FOREIGN KEY ("tenant_id","author_tenant_user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_response_comments" VALIDATE CONSTRAINT "form_response_comments_tenant_author_fk";--> statement-breakpoint
ALTER TABLE "form_response_comments" DROP CONSTRAINT "form_response_comments_author_tenant_user_id_tenant_users_id_fk";--> statement-breakpoint
ALTER TABLE "flow_gates" ADD CONSTRAINT "flow_gates_tenant_assignee_fk" FOREIGN KEY ("tenant_id","assignee_tenant_user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "flow_gates" VALIDATE CONSTRAINT "flow_gates_tenant_assignee_fk";--> statement-breakpoint
ALTER TABLE "flow_gates" DROP CONSTRAINT "flow_gates_assignee_tenant_user_id_tenant_users_id_fk";--> statement-breakpoint
ALTER TABLE "flow_gates" ADD CONSTRAINT "flow_gates_tenant_decided_by_fk" FOREIGN KEY ("tenant_id","decided_by_tenant_user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "flow_gates" VALIDATE CONSTRAINT "flow_gates_tenant_decided_by_fk";--> statement-breakpoint
ALTER TABLE "flow_gates" DROP CONSTRAINT "flow_gates_decided_by_tenant_user_id_tenant_users_id_fk";--> statement-breakpoint

CREATE UNIQUE INDEX "data_sources_tenant_id_id_ux" ON "data_sources" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_connections_tenant_id_id_ux" ON "sync_connections" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_runs_tenant_id_id_ux" ON "sync_runs" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_groups_tenant_id_id_ux" ON "notification_groups" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "data_sources_created_by_idx" ON "data_sources" USING btree ("tenant_id","created_by_tenant_user_id");--> statement-breakpoint
DROP INDEX "data_source_rows_source_idx";--> statement-breakpoint
CREATE INDEX "data_source_rows_source_idx" ON "data_source_rows" USING btree ("tenant_id","data_source_id","position");--> statement-breakpoint
DROP INDEX "sync_runs_connection_idx";--> statement-breakpoint
CREATE INDEX "sync_runs_connection_idx" ON "sync_runs" USING btree ("tenant_id","connection_id","started_at");--> statement-breakpoint
DROP INDEX "sync_record_changes_run_idx";--> statement-breakpoint
CREATE INDEX "sync_record_changes_run_idx" ON "sync_record_changes" USING btree ("tenant_id","run_id");--> statement-breakpoint
DROP INDEX "sync_record_changes_connection_run_idx";--> statement-breakpoint
CREATE INDEX "sync_record_changes_connection_run_idx" ON "sync_record_changes" USING btree ("tenant_id","connection_id","run_id");--> statement-breakpoint
DROP INDEX "notification_group_members_group_idx";--> statement-breakpoint
CREATE INDEX "notification_group_members_group_idx" ON "notification_group_members" USING btree ("tenant_id","group_id");--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_tenant_created_by_fk" FOREIGN KEY ("tenant_id","created_by_tenant_user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "data_sources" VALIDATE CONSTRAINT "data_sources_tenant_created_by_fk";--> statement-breakpoint
ALTER TABLE "data_sources" DROP CONSTRAINT "data_sources_created_by_tenant_user_id_tenant_users_id_fk";--> statement-breakpoint
ALTER TABLE "data_source_rows" ADD CONSTRAINT "data_source_rows_tenant_source_fk" FOREIGN KEY ("tenant_id","data_source_id") REFERENCES "public"."data_sources"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "data_source_rows" VALIDATE CONSTRAINT "data_source_rows_tenant_source_fk";--> statement-breakpoint
ALTER TABLE "data_source_rows" DROP CONSTRAINT "data_source_rows_data_source_id_data_sources_id_fk";--> statement-breakpoint
ALTER TABLE "sync_crosswalk" ADD CONSTRAINT "sync_crosswalk_tenant_connection_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."sync_connections"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "sync_crosswalk" VALIDATE CONSTRAINT "sync_crosswalk_tenant_connection_fk";--> statement-breakpoint
ALTER TABLE "sync_crosswalk" DROP CONSTRAINT "sync_crosswalk_connection_id_sync_connections_id_fk";--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_tenant_connection_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."sync_connections"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "sync_runs" VALIDATE CONSTRAINT "sync_runs_tenant_connection_fk";--> statement-breakpoint
ALTER TABLE "sync_runs" DROP CONSTRAINT "sync_runs_connection_id_sync_connections_id_fk";--> statement-breakpoint
ALTER TABLE "sync_record_changes" ADD CONSTRAINT "sync_record_changes_tenant_connection_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."sync_connections"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "sync_record_changes" VALIDATE CONSTRAINT "sync_record_changes_tenant_connection_fk";--> statement-breakpoint
ALTER TABLE "sync_record_changes" DROP CONSTRAINT "sync_record_changes_connection_id_sync_connections_id_fk";--> statement-breakpoint
ALTER TABLE "sync_record_changes" ADD CONSTRAINT "sync_record_changes_tenant_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."sync_runs"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "sync_record_changes" VALIDATE CONSTRAINT "sync_record_changes_tenant_run_fk";--> statement-breakpoint
ALTER TABLE "sync_record_changes" DROP CONSTRAINT "sync_record_changes_run_id_sync_runs_id_fk";--> statement-breakpoint
ALTER TABLE "notification_group_members" ADD CONSTRAINT "notification_group_members_tenant_group_fk" FOREIGN KEY ("tenant_id","group_id") REFERENCES "public"."notification_groups"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "notification_group_members" VALIDATE CONSTRAINT "notification_group_members_tenant_group_fk";--> statement-breakpoint
ALTER TABLE "notification_group_members" DROP CONSTRAINT "notification_group_members_group_id_notification_groups_id_fk";--> statement-breakpoint

CREATE UNIQUE INDEX "compliance_obligations_tenant_id_id_ux" ON "compliance_obligations" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "people_tenant_id_id_ux" ON "people" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_assignments_tenant_id_id_ux" ON "form_assignments" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_assignments_tenant_id_id_ux" ON "inspection_assignments" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_assignments_tenant_id_id_ux" ON "journal_assignments" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "compliance_obligations_created_by_idx" ON "compliance_obligations" USING btree ("tenant_id","created_by_tenant_user_id");--> statement-breakpoint
DROP INDEX "compliance_audience_obligation_idx";--> statement-breakpoint
CREATE INDEX "compliance_audience_obligation_idx" ON "compliance_audience" USING btree ("tenant_id","obligation_id");--> statement-breakpoint
DROP INDEX "compliance_audience_unique_ux";--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_audience_unique_ux" ON "compliance_audience" USING btree ("tenant_id","obligation_id","kind","entity_key");--> statement-breakpoint
DROP INDEX "compliance_dispatches_obligation_idx";--> statement-breakpoint
CREATE INDEX "compliance_dispatches_obligation_idx" ON "compliance_dispatches" USING btree ("tenant_id","obligation_id","occurred_at");--> statement-breakpoint
DROP INDEX "compliance_dispatches_obligation_occurrence_ux";--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_dispatches_obligation_occurrence_ux" ON "compliance_dispatches" USING btree ("tenant_id","obligation_id","occurred_at");--> statement-breakpoint
DROP INDEX "compliance_status_obligation_idx";--> statement-breakpoint
CREATE INDEX "compliance_status_obligation_idx" ON "compliance_status" USING btree ("tenant_id","obligation_id");--> statement-breakpoint
DROP INDEX "compliance_status_unique_ux";--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_status_unique_ux" ON "compliance_status" USING btree ("tenant_id","obligation_id","subject_key");--> statement-breakpoint
DROP INDEX "form_assignment_dispatches_assignment_idx";--> statement-breakpoint
CREATE INDEX "form_assignment_dispatches_assignment_idx" ON "form_assignment_dispatches" USING btree ("tenant_id","assignment_id","occurred_at");--> statement-breakpoint
DROP INDEX "form_assignment_dispatches_assignment_occurrence_ux";--> statement-breakpoint
CREATE UNIQUE INDEX "form_assignment_dispatches_assignment_occurrence_ux" ON "form_assignment_dispatches" USING btree ("tenant_id","assignment_id","occurred_at");--> statement-breakpoint
DROP INDEX "inspection_assignment_compliance_assignment_idx";--> statement-breakpoint
CREATE INDEX "inspection_assignment_compliance_assignment_idx" ON "inspection_assignment_compliance" USING btree ("tenant_id","assignment_id");--> statement-breakpoint
CREATE INDEX "inspection_assignment_compliance_person_idx" ON "inspection_assignment_compliance" USING btree ("tenant_id","person_id");--> statement-breakpoint
DROP INDEX "inspection_assignment_compliance_assignment_person_ux";--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_assignment_compliance_assignment_person_ux" ON "inspection_assignment_compliance" USING btree ("tenant_id","assignment_id","person_id");--> statement-breakpoint
DROP INDEX "inspection_assignment_dispatches_assignment_idx";--> statement-breakpoint
CREATE INDEX "inspection_assignment_dispatches_assignment_idx" ON "inspection_assignment_dispatches" USING btree ("tenant_id","assignment_id","occurred_at");--> statement-breakpoint
DROP INDEX "journal_assignment_dispatches_assignment_idx";--> statement-breakpoint
CREATE INDEX "journal_assignment_dispatches_assignment_idx" ON "journal_assignment_dispatches" USING btree ("tenant_id","assignment_id");--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_obligations_tenant_created_by_fk" FOREIGN KEY ("tenant_id","created_by_tenant_user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "compliance_obligations" VALIDATE CONSTRAINT "compliance_obligations_tenant_created_by_fk";--> statement-breakpoint
ALTER TABLE "compliance_obligations" DROP CONSTRAINT "compliance_obligations_created_by_tenant_user_id_tenant_users_i";--> statement-breakpoint
ALTER TABLE "compliance_audience" ADD CONSTRAINT "compliance_audience_tenant_obligation_fk" FOREIGN KEY ("tenant_id","obligation_id") REFERENCES "public"."compliance_obligations"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "compliance_audience" VALIDATE CONSTRAINT "compliance_audience_tenant_obligation_fk";--> statement-breakpoint
ALTER TABLE "compliance_audience" DROP CONSTRAINT "compliance_audience_obligation_id_compliance_obligations_id_fk";--> statement-breakpoint
ALTER TABLE "compliance_dispatches" ADD CONSTRAINT "compliance_dispatches_tenant_obligation_fk" FOREIGN KEY ("tenant_id","obligation_id") REFERENCES "public"."compliance_obligations"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "compliance_dispatches" VALIDATE CONSTRAINT "compliance_dispatches_tenant_obligation_fk";--> statement-breakpoint
ALTER TABLE "compliance_dispatches" DROP CONSTRAINT "compliance_dispatches_obligation_id_compliance_obligations_id_f";--> statement-breakpoint
ALTER TABLE "compliance_status" ADD CONSTRAINT "compliance_status_tenant_obligation_fk" FOREIGN KEY ("tenant_id","obligation_id") REFERENCES "public"."compliance_obligations"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "compliance_status" VALIDATE CONSTRAINT "compliance_status_tenant_obligation_fk";--> statement-breakpoint
ALTER TABLE "compliance_status" DROP CONSTRAINT "compliance_status_obligation_id_compliance_obligations_id_fk";--> statement-breakpoint
ALTER TABLE "compliance_status" ADD CONSTRAINT "compliance_status_tenant_person_fk" FOREIGN KEY ("tenant_id","person_id") REFERENCES "public"."people"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "compliance_status" VALIDATE CONSTRAINT "compliance_status_tenant_person_fk";--> statement-breakpoint
ALTER TABLE "compliance_status" DROP CONSTRAINT "compliance_status_person_id_people_id_fk";--> statement-breakpoint
ALTER TABLE "form_assignment_dispatches" ADD CONSTRAINT "form_assignment_dispatches_tenant_assignment_fk" FOREIGN KEY ("tenant_id","assignment_id") REFERENCES "public"."form_assignments"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_assignment_dispatches" VALIDATE CONSTRAINT "form_assignment_dispatches_tenant_assignment_fk";--> statement-breakpoint
ALTER TABLE "form_assignment_dispatches" DROP CONSTRAINT "form_assignment_dispatches_assignment_id_form_assignments_id_fk";--> statement-breakpoint
ALTER TABLE "inspection_assignment_compliance" ADD CONSTRAINT "inspection_assignment_compliance_tenant_assignment_fk" FOREIGN KEY ("tenant_id","assignment_id") REFERENCES "public"."inspection_assignments"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "inspection_assignment_compliance" VALIDATE CONSTRAINT "inspection_assignment_compliance_tenant_assignment_fk";--> statement-breakpoint
ALTER TABLE "inspection_assignment_compliance" DROP CONSTRAINT "inspection_assignment_compliance_assignment_id_inspection_assig";--> statement-breakpoint
ALTER TABLE "inspection_assignment_compliance" ADD CONSTRAINT "inspection_assignment_compliance_tenant_person_fk" FOREIGN KEY ("tenant_id","person_id") REFERENCES "public"."people"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "inspection_assignment_compliance" VALIDATE CONSTRAINT "inspection_assignment_compliance_tenant_person_fk";--> statement-breakpoint
ALTER TABLE "inspection_assignment_compliance" DROP CONSTRAINT "inspection_assignment_compliance_person_id_people_id_fk";--> statement-breakpoint
ALTER TABLE "inspection_assignment_dispatches" ADD CONSTRAINT "inspection_assignment_dispatches_tenant_assignment_fk" FOREIGN KEY ("tenant_id","assignment_id") REFERENCES "public"."inspection_assignments"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "inspection_assignment_dispatches" VALIDATE CONSTRAINT "inspection_assignment_dispatches_tenant_assignment_fk";--> statement-breakpoint
ALTER TABLE "inspection_assignment_dispatches" DROP CONSTRAINT "inspection_assignment_dispatches_assignment_id_inspection_assig";--> statement-breakpoint
ALTER TABLE "journal_assignment_dispatches" ADD CONSTRAINT "journal_assignment_dispatches_tenant_assignment_fk" FOREIGN KEY ("tenant_id","assignment_id") REFERENCES "public"."journal_assignments"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "journal_assignment_dispatches" VALIDATE CONSTRAINT "journal_assignment_dispatches_tenant_assignment_fk";--> statement-breakpoint
ALTER TABLE "journal_assignment_dispatches" DROP CONSTRAINT "journal_assignment_dispatches_assignment_id_journal_assignments";
