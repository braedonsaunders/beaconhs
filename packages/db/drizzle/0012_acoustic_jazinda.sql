ALTER TYPE "public"."hazid_signed_report_status" ADD VALUE IF NOT EXISTS 'rendering' BEFORE 'failed';--> statement-breakpoint
ALTER TYPE "public"."hazid_signed_report_status" ADD VALUE IF NOT EXISTS 'completed' BEFORE 'failed';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_dashboard_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"layout" jsonb NOT NULL,
	"source_role" text,
	"is_customised" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hazid_signed_reports" ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hazid_signed_reports" ADD COLUMN IF NOT EXISTS "error_message" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_dashboard_layouts" ADD CONSTRAINT "user_dashboard_layouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_dashboard_layouts" ADD CONSTRAINT "user_dashboard_layouts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_dashboard_layouts_user_ux" ON "user_dashboard_layouts" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_dashboard_layouts_tenant_idx" ON "user_dashboard_layouts" USING btree ("tenant_id");