-- Additive: when each person joined an obligation's audience, for one-time
-- requirements due a number of days after joining. Older replicas never read it.
CREATE TABLE IF NOT EXISTS "compliance_audience_joins" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "obligation_id" uuid NOT NULL,
  "person_id" uuid NOT NULL,
  "joined_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "compliance_audience_joins_tenant_obligation_fk" FOREIGN KEY ("tenant_id", "obligation_id") REFERENCES "compliance_obligations"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "compliance_audience_joins_tenant_person_fk" FOREIGN KEY ("tenant_id", "person_id") REFERENCES "people"("tenant_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compliance_audience_joins_tenant_idx" ON "compliance_audience_joins" ("tenant_id");
CREATE INDEX IF NOT EXISTS "compliance_audience_joins_person_idx" ON "compliance_audience_joins" ("tenant_id", "person_id");
CREATE UNIQUE INDEX IF NOT EXISTS "compliance_audience_joins_member_ux" ON "compliance_audience_joins" ("tenant_id", "obligation_id", "person_id");
--> statement-breakpoint
ALTER TABLE "compliance_audience_joins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_audience_joins" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "compliance_audience_joins";
CREATE POLICY tenant_isolation ON "compliance_audience_joins"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
