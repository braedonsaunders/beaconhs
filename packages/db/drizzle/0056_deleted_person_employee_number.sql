-- Retain deleted people's history while allowing a replacement identity to use
-- their employee number. Current people still require a unique number per tenant.
DROP INDEX IF EXISTS "people_tenant_employee_no_ux";
--> statement-breakpoint
CREATE UNIQUE INDEX "people_tenant_employee_no_ux"
  ON "people" ("tenant_id", "employee_no") WHERE "deleted_at" IS NULL;
