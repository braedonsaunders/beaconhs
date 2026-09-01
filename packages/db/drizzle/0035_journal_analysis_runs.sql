-- Background Insights journal analysis. The dashboard reads stored runs; the
-- worker writes them. Lookback windows are 7 / 30 / 90 days.

CREATE TYPE "journal_analysis_run_status" AS ENUM ('pending', 'running', 'succeeded', 'failed');--> statement-breakpoint

CREATE TABLE "journal_analysis_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "days" integer NOT NULL,
  "status" "journal_analysis_run_status" DEFAULT 'pending' NOT NULL,
  "entry_count" integer DEFAULT 0 NOT NULL,
  "result" jsonb,
  "error" text,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_by_tenant_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "journal_analysis_runs"
  ADD CONSTRAINT "journal_analysis_runs_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade;--> statement-breakpoint

ALTER TABLE "journal_analysis_runs"
  ADD CONSTRAINT "journal_analysis_runs_tenant_created_by_fk"
  FOREIGN KEY ("tenant_id", "created_by_tenant_user_id")
  REFERENCES "tenant_users"("tenant_id", "id");--> statement-breakpoint

CREATE INDEX "journal_analysis_runs_created_by_idx"
  ON "journal_analysis_runs" ("tenant_id", "created_by_tenant_user_id");--> statement-breakpoint

ALTER TABLE "journal_analysis_runs"
  ADD CONSTRAINT "journal_analysis_runs_days_ck"
  CHECK ("days" IN (7, 30, 90));--> statement-breakpoint

CREATE INDEX "journal_analysis_runs_tenant_days_created_idx"
  ON "journal_analysis_runs" ("tenant_id", "days", "created_at");--> statement-breakpoint

CREATE INDEX "journal_analysis_runs_tenant_status_idx"
  ON "journal_analysis_runs" ("tenant_id", "status");
