-- Per-criterion answer-depth fields for inspection_record_criteria.
--
-- Most of the rich-answer columns already exist (severity, non_compliance_description,
-- action_taken, compliant_note, assigned_to_person_id, assigned_to_tenant_user_id,
-- assigned_due_date). This migration adds the missing `corrected_on` date so the UI
-- can flag overdue findings, and tightens the ON DELETE behaviour on the two
-- assignee FKs from NO ACTION → SET NULL so deleting a person / tenant_user nulls
-- out the assignment instead of blocking the delete.
--
-- Idempotent: re-running the migration is safe.

ALTER TABLE "inspection_record_criteria"
  ADD COLUMN IF NOT EXISTS "corrected_on" date;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "inspection_record_criteria"
    DROP CONSTRAINT IF EXISTS "inspection_record_criteria_assigned_to_person_id_people_id_fk";
EXCEPTION WHEN undefined_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "inspection_record_criteria"
    ADD CONSTRAINT "inspection_record_criteria_assigned_to_person_id_people_id_fk"
    FOREIGN KEY ("assigned_to_person_id")
    REFERENCES "public"."people"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "inspection_record_criteria"
    DROP CONSTRAINT IF EXISTS "inspection_record_criteria_assigned_to_tenant_user_id_tenant_users_id_fk";
EXCEPTION WHEN undefined_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "inspection_record_criteria"
    ADD CONSTRAINT "inspection_record_criteria_assigned_to_tenant_user_id_tenant_users_id_fk"
    FOREIGN KEY ("assigned_to_tenant_user_id")
    REFERENCES "public"."tenant_users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "inspection_record_criteria_corrected_on_idx"
  ON "inspection_record_criteria" USING btree ("tenant_id","corrected_on");
