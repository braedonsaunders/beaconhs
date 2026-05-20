-- Score-based routing for form responses.
--
-- Adds:
--   form_response_status enum gains 'non_compliant'
--   form_response_compliance_status enum: compliant | non_compliant | pending_review
--   form_responses.compliance_score          numeric(6,2) null
--   form_responses.compliance_status         form_response_compliance_status null
--   corrective_actions.source_form_response_id  uuid null
--   incidents.source_form_response_id           uuid null
--
-- All additions are idempotent (IF NOT EXISTS / EXCEPTION DO NOTHING). Safe to
-- re-run; no data is rewritten, no NOT NULL constraints are added without a
-- default.

-- 1. New compliance-status enum --------------------------------------------
DO $$ BEGIN
  CREATE TYPE "public"."form_response_compliance_status" AS ENUM
    ('compliant', 'non_compliant', 'pending_review');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- 2. Extend form_response_status with 'non_compliant' ---------------------
DO $$ BEGIN
  ALTER TYPE "public"."form_response_status" ADD VALUE IF NOT EXISTS 'non_compliant';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- 3. form_responses new columns -------------------------------------------
DO $$ BEGIN
  ALTER TABLE "form_responses"
    ADD COLUMN IF NOT EXISTS "compliance_score" numeric(6, 2);
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "form_responses"
    ADD COLUMN IF NOT EXISTS "compliance_status" "public"."form_response_compliance_status";
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "form_responses_compliance_status_idx"
  ON "form_responses" USING btree ("tenant_id", "compliance_status");--> statement-breakpoint

-- 4. corrective_actions.source_form_response_id ---------------------------
DO $$ BEGIN
  ALTER TABLE "corrective_actions"
    ADD COLUMN IF NOT EXISTS "source_form_response_id" uuid;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "corrective_actions_source_form_response_idx"
  ON "corrective_actions" USING btree ("tenant_id", "source_form_response_id");--> statement-breakpoint

-- 5. incidents.source_form_response_id ------------------------------------
DO $$ BEGIN
  ALTER TABLE "incidents"
    ADD COLUMN IF NOT EXISTS "source_form_response_id" uuid;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "incidents_source_form_response_idx"
  ON "incidents" USING btree ("tenant_id", "source_form_response_id");
