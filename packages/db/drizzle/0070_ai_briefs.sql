-- AI Briefs: scheduled AI-written analyses with immutable run evidence, plus
-- per-call AI usage metering. Replaces the single-purpose journal analysis.
DO $$ BEGIN
  CREATE TYPE "brief_status" AS ENUM ('active', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "brief_run_status" AS ENUM ('queued', 'running', 'succeeded', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "brief_run_trigger" AS ENUM ('scheduled', 'manual', 'preview', 'api');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "brief_schedule_split" AS ENUM ('none', 'department');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "briefs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "template_key" text,
  "name" text NOT NULL,
  "description" text,
  "spec" jsonb NOT NULL,
  "spec_version" integer DEFAULT 1 NOT NULL,
  "status" "brief_status" DEFAULT 'active' NOT NULL,
  "created_by_tenant_user_id" uuid,
  "updated_by_tenant_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "briefs_name_nonblank_ck" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "briefs_spec_version_ck" CHECK ("spec_version" >= 1),
  CONSTRAINT "briefs_tenant_created_by_fk" FOREIGN KEY ("tenant_id", "created_by_tenant_user_id")
    REFERENCES "tenant_users"("tenant_id", "id"),
  CONSTRAINT "briefs_tenant_updated_by_fk" FOREIGN KEY ("tenant_id", "updated_by_tenant_user_id")
    REFERENCES "tenant_users"("tenant_id", "id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefs_tenant_idx" ON "briefs" ("tenant_id", "status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "briefs_tenant_id_id_ux" ON "briefs" ("tenant_id", "id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefs_created_by_idx" ON "briefs" ("tenant_id", "created_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefs_updated_by_idx" ON "briefs" ("tenant_id", "updated_by_tenant_user_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "brief_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "brief_id" uuid NOT NULL,
  "name" text NOT NULL,
  "cadence" "report_cadence" NOT NULL,
  "repeat_every" integer DEFAULT 1 NOT NULL,
  "day_of_week" integer,
  "day_of_month" integer,
  "week_of_month" integer,
  "hour" integer NOT NULL,
  "minute" integer NOT NULL,
  "timezone" text DEFAULT 'America/Toronto' NOT NULL,
  "starts_on" date,
  "ends_on" date,
  "weekdays_only" boolean DEFAULT false NOT NULL,
  "window" jsonb NOT NULL,
  "split" "brief_schedule_split" DEFAULT 'none' NOT NULL,
  "recipient_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "recipient_group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "recipient_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "email_subject" text,
  "run_as_tenant_user_id" uuid NOT NULL,
  "run_as_role_id" uuid,
  "next_run_at" timestamp with time zone,
  "last_run_at" timestamp with time zone,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "brief_schedules_repeat_every_ck" CHECK ("repeat_every" between 1 and 999),
  CONSTRAINT "brief_schedules_time_ck" CHECK ("hour" between 0 and 23 and "minute" between 0 and 59),
  CONSTRAINT "brief_schedules_date_bounds_ck" CHECK ("starts_on" is null or "ends_on" is null or "starts_on" <= "ends_on"),
  CONSTRAINT "brief_schedules_tenant_brief_fk" FOREIGN KEY ("tenant_id", "brief_id")
    REFERENCES "briefs"("tenant_id", "id") ON DELETE cascade,
  CONSTRAINT "brief_schedules_tenant_run_as_user_fk" FOREIGN KEY ("tenant_id", "run_as_tenant_user_id")
    REFERENCES "tenant_users"("tenant_id", "id") ON DELETE restrict,
  CONSTRAINT "brief_schedules_tenant_run_as_role_fk" FOREIGN KEY ("tenant_id", "run_as_role_id")
    REFERENCES "roles"("tenant_id", "id") ON DELETE restrict
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brief_schedules_tenant_idx" ON "brief_schedules" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brief_schedules_due_idx" ON "brief_schedules" ("active", "next_run_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brief_schedules_brief_idx" ON "brief_schedules" ("tenant_id", "brief_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brief_schedules_run_as_tenant_user_idx" ON "brief_schedules" ("tenant_id", "run_as_tenant_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brief_schedules_run_as_role_idx" ON "brief_schedules" ("tenant_id", "run_as_role_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brief_schedules_tenant_id_id_ux" ON "brief_schedules" ("tenant_id", "id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "brief_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "brief_id" uuid NOT NULL,
  "schedule_id" uuid,
  "occurrence_key" text,
  "scheduled_for" timestamp with time zone,
  "trigger" "brief_run_trigger" NOT NULL,
  "status" "brief_run_status" DEFAULT 'queued' NOT NULL,
  "brief_name" text NOT NULL,
  "spec_version" integer NOT NULL,
  "spec_snapshot" jsonb NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "window_end" timestamp with time zone NOT NULL,
  "window_label" text NOT NULL,
  "timezone" text NOT NULL,
  "department_id" uuid,
  "delivery" jsonb,
  "run_as_tenant_user_id" uuid,
  "run_as_role_id" uuid,
  "requested_by_tenant_user_id" uuid,
  "requested_by_api_key_id" uuid,
  "result" jsonb,
  "evidence" jsonb,
  "ai_meta" jsonb,
  "error" text,
  "pdf_attachment_id" uuid,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "brief_runs_window_ck" CHECK ("window_start" < "window_end"),
  CONSTRAINT "brief_runs_scheduled_ck" CHECK ("trigger" <> 'scheduled' or ("scheduled_for" is not null and "occurrence_key" is not null)),
  CONSTRAINT "brief_runs_tenant_brief_fk" FOREIGN KEY ("tenant_id", "brief_id")
    REFERENCES "briefs"("tenant_id", "id") ON DELETE cascade,
  CONSTRAINT "brief_runs_tenant_schedule_fk" FOREIGN KEY ("tenant_id", "schedule_id")
    REFERENCES "brief_schedules"("tenant_id", "id"),
  CONSTRAINT "att_tenant_brief_runs_pdf_attachment_id_ccc1004b" FOREIGN KEY ("tenant_id", "pdf_attachment_id")
    REFERENCES "attachments"("tenant_id", "id") ON DELETE SET NULL ("pdf_attachment_id"),
  CONSTRAINT "brief_runs_tenant_requested_by_fk" FOREIGN KEY ("tenant_id", "requested_by_tenant_user_id")
    REFERENCES "tenant_users"("tenant_id", "id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brief_runs_tenant_idx" ON "brief_runs" ("tenant_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brief_runs_brief_idx" ON "brief_runs" ("tenant_id", "brief_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brief_runs_schedule_idx" ON "brief_runs" ("tenant_id", "schedule_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brief_runs_status_idx" ON "brief_runs" ("status", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brief_runs_department_idx" ON "brief_runs" ("tenant_id", "department_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brief_runs_run_as_idx" ON "brief_runs" ("tenant_id", "run_as_tenant_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brief_runs_requested_by_idx" ON "brief_runs" ("tenant_id", "requested_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brief_runs_pdf_attachment_idx" ON "brief_runs" ("tenant_id", "pdf_attachment_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brief_runs_schedule_occurrence_ux" ON "brief_runs" ("schedule_id", "occurrence_key") WHERE "schedule_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brief_runs_tenant_id_id_ux" ON "brief_runs" ("tenant_id", "id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "brief_run_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "run_id" uuid NOT NULL,
  "recipient_email" text NOT NULL,
  "status" "report_run_delivery_status" DEFAULT 'queued' NOT NULL,
  "email_job_id" text,
  "error" text,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "brief_run_deliveries_tenant_run_fk" FOREIGN KEY ("tenant_id", "run_id")
    REFERENCES "brief_runs"("tenant_id", "id") ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brief_run_deliveries_run_recipient_ux" ON "brief_run_deliveries" ("run_id", "recipient_email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brief_run_deliveries_tenant_run_idx" ON "brief_run_deliveries" ("tenant_id", "run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brief_run_deliveries_status_idx" ON "brief_run_deliveries" ("status");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "feature" text NOT NULL,
  "tier" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "latency_ms" integer DEFAULT 0 NOT NULL,
  "outcome" text NOT NULL,
  "error" text,
  "tenant_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_usage_events_outcome_ck" CHECK ("outcome" in ('succeeded', 'failed')),
  CONSTRAINT "ai_usage_events_tokens_ck" CHECK ("input_tokens" >= 0 and "output_tokens" >= 0 and "latency_ms" >= 0),
  CONSTRAINT "ai_usage_events_tenant_user_fk" FOREIGN KEY ("tenant_id", "tenant_user_id")
    REFERENCES "tenant_users"("tenant_id", "id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_events_tenant_created_idx" ON "ai_usage_events" ("tenant_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_events_tenant_feature_idx" ON "ai_usage_events" ("tenant_id", "feature", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_events_tenant_user_idx" ON "ai_usage_events" ("tenant_id", "tenant_user_id");--> statement-breakpoint

-- The single-purpose journal analysis is replaced by the "Journal pulse" brief.
-- Remove its stored snapshots, its Insights widget from saved layouts, and the
-- tenant opt-in flag. FORCE RLS applies to the migration owner, so each tenant
-- is scoped in turn.
DO $$
DECLARE
  tenant uuid;
  previous_tenant text := current_setting('app.tenant_id', true);
BEGIN
  FOR tenant IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant::text, true);
    UPDATE insight_dashboards
    SET layout = jsonb_build_object(
          'widgets',
          coalesce((
            SELECT jsonb_agg(widget ORDER BY ordinal)
            FROM jsonb_array_elements(layout -> 'widgets') WITH ORDINALITY AS w(widget, ordinal)
            WHERE widget ->> 'id' <> 'ai-analysis'
          ), '[]'::jsonb)
        ),
        updated_at = now()
    WHERE tenant_id = tenant
      AND layout -> 'widgets' @> '[{"id": "ai-analysis"}]'::jsonb;
    UPDATE tenants
    SET settings = jsonb_set(settings, '{ai}', (settings -> 'ai') - 'autoJournalAnalysis')
    WHERE id = tenant
      AND settings -> 'ai' ? 'autoJournalAnalysis';
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
END $$;--> statement-breakpoint
DROP TABLE IF EXISTS "journal_analysis_runs";--> statement-breakpoint
DROP TYPE IF EXISTS "journal_analysis_run_status";
