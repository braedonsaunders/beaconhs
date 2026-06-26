CREATE TABLE IF NOT EXISTS "role_dashboard_layouts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "role_id" uuid NOT NULL,
  "layout" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "role_dashboard_layouts_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "role_dashboard_layouts_role_id_roles_id_fk"
    FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "role_dashboard_layouts_role_ux" ON "role_dashboard_layouts" USING btree ("tenant_id","role_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_dashboard_layouts_tenant_idx" ON "role_dashboard_layouts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_dashboard_layouts_role_idx" ON "role_dashboard_layouts" USING btree ("role_id");--> statement-breakpoint

ALTER TABLE "user_dashboard_layouts" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "user_dashboard_layouts"
SET "source_role" = 'tier:' || "source_role"
WHERE "source_role" IN ('super_admin', 'tenant_admin', 'safety_manager', 'foreman', 'worker');--> statement-breakpoint
ALTER TABLE "user_dashboard_layouts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "role_dashboard_layouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_dashboard_layouts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "role_dashboard_layouts";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "role_dashboard_layouts"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
