CREATE TABLE IF NOT EXISTS "form_assignment_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"audience_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tenant_plugin_id" uuid NOT NULL,
	"cadence" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"status" text DEFAULT 'queued' NOT NULL,
	"duration_ms" text,
	"summary" text,
	"error" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_assignment_dispatches" ADD CONSTRAINT "form_assignment_dispatches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_assignment_dispatches" ADD CONSTRAINT "form_assignment_dispatches_assignment_id_form_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."form_assignments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plugin_runs" ADD CONSTRAINT "plugin_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plugin_runs" ADD CONSTRAINT "plugin_runs_tenant_plugin_id_tenant_plugins_id_fk" FOREIGN KEY ("tenant_plugin_id") REFERENCES "public"."tenant_plugins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_assignment_dispatches_tenant_idx" ON "form_assignment_dispatches" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_assignment_dispatches_assignment_idx" ON "form_assignment_dispatches" USING btree ("assignment_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_runs_tenant_idx" ON "plugin_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_runs_plugin_idx" ON "plugin_runs" USING btree ("tenant_plugin_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_runs_cadence_idx" ON "plugin_runs" USING btree ("cadence","started_at");