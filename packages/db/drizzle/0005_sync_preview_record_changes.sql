ALTER TABLE "sync_connections" ADD COLUMN IF NOT EXISTS "cursor" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN IF NOT EXISTS "dry_run" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN IF NOT EXISTS "cursor_before" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN IF NOT EXISTS "cursor_after" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sync_record_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "connection_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "entity" text NOT NULL,
  "external_id" text NOT NULL,
  "canonical_id" uuid,
  "action" text NOT NULL,
  "dry_run" boolean DEFAULT false NOT NULL,
  "row_hash" text,
  "before" jsonb,
  "after" jsonb,
  "diff" jsonb,
  "message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sync_record_changes_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sync_record_changes_connection_id_sync_connections_id_fk"
    FOREIGN KEY ("connection_id") REFERENCES "public"."sync_connections"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sync_record_changes_run_id_sync_runs_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "public"."sync_runs"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sync_record_changes_tenant_idx" ON "sync_record_changes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_record_changes_run_idx" ON "sync_record_changes" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_record_changes_connection_run_idx" ON "sync_record_changes" USING btree ("connection_id","run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_record_changes_entity_action_idx" ON "sync_record_changes" USING btree ("tenant_id","entity","action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_record_changes_external_idx" ON "sync_record_changes" USING btree ("tenant_id","connection_id","entity","external_id");--> statement-breakpoint

ALTER TABLE "sync_record_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_record_changes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "sync_record_changes";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sync_record_changes"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
