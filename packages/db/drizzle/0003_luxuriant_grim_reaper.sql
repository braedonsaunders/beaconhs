CREATE TYPE "public"."report_cadence" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."report_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"query_kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "report_run_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"pdf_attachment_id" uuid,
	"row_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"name" text NOT NULL,
	"cadence" "report_cadence" NOT NULL,
	"day_of_week" integer,
	"day_of_month" integer,
	"hour" integer NOT NULL,
	"minute" integer NOT NULL,
	"timezone" text DEFAULT 'America/Toronto' NOT NULL,
	"recipient_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recipient_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_notification_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_schedule_id_report_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."report_schedules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_pdf_attachment_id_attachments_id_fk" FOREIGN KEY ("pdf_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_definition_id_report_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."report_definitions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_notification_recipients" ADD CONSTRAINT "tenant_notification_recipients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_notification_recipients" ADD CONSTRAINT "tenant_notification_recipients_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "report_definitions_slug_ux" ON "report_definitions" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_runs_tenant_idx" ON "report_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_runs_schedule_idx" ON "report_runs" USING btree ("schedule_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_runs_status_idx" ON "report_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_schedules_tenant_idx" ON "report_schedules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_schedules_active_idx" ON "report_schedules" USING btree ("active","next_run_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_schedules_definition_idx" ON "report_schedules" USING btree ("definition_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_notification_recipients_tenant_idx" ON "tenant_notification_recipients" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_notification_recipients_uniq" ON "tenant_notification_recipients" USING btree ("tenant_id","category","user_id");