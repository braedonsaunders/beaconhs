-- Default PDF templates for ALL record subjects: the partial unique index that
-- enforced "one default per (tenant, module)" now also covers form_template
-- subjects, so a Builder app can flag its own default response template.
-- Idempotent: safe on push-managed databases too.
DROP INDEX IF EXISTS "pdf_templates_module_default_ux";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pdf_templates_subject_default_ux"
  ON "pdf_templates" ("tenant_id", "record_subject_type", "record_subject_key")
  WHERE "is_module_default" AND "record_subject_type" IS NOT NULL AND "deleted_at" IS NULL;
