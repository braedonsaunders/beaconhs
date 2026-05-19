CREATE TYPE "public"."email_log_status" AS ENUM('queued', 'sent', 'failed', 'bounced', 'opened');--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"job_id" text,
	"provider_message_id" text,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recipient_primary" text,
	"cc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bcc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"from_addr" text NOT NULL,
	"reply_to_addr" text,
	"subject" text NOT NULL,
	"html_size" integer DEFAULT 0 NOT NULL,
	"text_size" integer DEFAULT 0 NOT NULL,
	"html_body" text,
	"text_body" text,
	"status" "email_log_status" DEFAULT 'queued' NOT NULL,
	"category_key" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form_response_steps" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "form_response_steps" ADD COLUMN IF NOT EXISTS "signature_data_url" text;--> statement-breakpoint
ALTER TABLE "form_response_steps" ADD COLUMN IF NOT EXISTS "signed_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "form_response_steps" ADD COLUMN IF NOT EXISTS "signed_by_tenant_user_id" uuid;--> statement-breakpoint
ALTER TABLE "form_response_steps" ADD COLUMN IF NOT EXISTS "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "form_response_steps" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "form_response_steps" ADD COLUMN IF NOT EXISTS "rejected_by_tenant_user_id" uuid;--> statement-breakpoint
ALTER TABLE "form_responses" ADD COLUMN IF NOT EXISTS "workflow_state" jsonb DEFAULT 'null'::jsonb;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_log_tenant_idx" ON "email_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "email_log_status_idx" ON "email_log" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "email_log_category_idx" ON "email_log" USING btree ("tenant_id","category_key","created_at");--> statement-breakpoint
CREATE INDEX "email_log_recipient_idx" ON "email_log" USING btree ("recipient_primary","created_at");--> statement-breakpoint
CREATE INDEX "email_log_job_idx" ON "email_log" USING btree ("job_id");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "form_response_steps" ADD CONSTRAINT "form_response_steps_signed_by_person_id_people_id_fk" FOREIGN KEY ("signed_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "form_response_steps" ADD CONSTRAINT "form_response_steps_signed_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("signed_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "form_response_steps" ADD CONSTRAINT "form_response_steps_rejected_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("rejected_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_response_steps_status_idx" ON "form_response_steps" USING btree ("tenant_id","status");