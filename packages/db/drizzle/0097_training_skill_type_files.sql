-- Additive storage: existing employee evidence and skill history are untouched.
CREATE TABLE IF NOT EXISTS "training_skill_type_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "skill_type_id" uuid NOT NULL,
  "attachment_id" uuid NOT NULL,
  "label" text NOT NULL,
  "kind" text NOT NULL,
  "uploaded_at" timestamptz NOT NULL DEFAULT now(),
  "uploaded_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "training_skill_type_files_tenant_type_fk" FOREIGN KEY ("tenant_id", "skill_type_id") REFERENCES "training_skill_types"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "training_skill_type_files_tenant_attachment_fk" FOREIGN KEY ("tenant_id", "attachment_id") REFERENCES "attachments"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "training_skill_type_files_kind_ck" CHECK ("kind" IN ('certificate', 'evidence', 'photo', 'other'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_skill_type_files_attachment_id_ref_idx" ON "training_skill_type_files" ("tenant_id", "attachment_id");
CREATE INDEX IF NOT EXISTS "training_skill_type_files_tenant_idx" ON "training_skill_type_files" ("tenant_id");
CREATE INDEX IF NOT EXISTS "training_skill_type_files_skill_type_idx" ON "training_skill_type_files" ("tenant_id", "skill_type_id");
CREATE INDEX IF NOT EXISTS "training_skill_type_files_kind_idx" ON "training_skill_type_files" ("tenant_id", "kind");
CREATE UNIQUE INDEX IF NOT EXISTS "training_skill_type_files_attachment_ux" ON "training_skill_type_files" ("tenant_id", "skill_type_id", "attachment_id");
--> statement-breakpoint
ALTER TABLE "training_skill_type_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "training_skill_type_files" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "training_skill_type_files";
CREATE POLICY tenant_isolation ON "training_skill_type_files"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
