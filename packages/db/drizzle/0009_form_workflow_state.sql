-- Wave 6 / Theme A — workflow-step UI for form responses
--
-- ADDITIVE migration. All columns are nullable or have defaults; no data is
-- rewritten, no constraints are tightened. Safe to apply against production
-- without downtime.
--
-- Adds:
--   form_responses.workflow_state        jsonb  null  default null
--   form_response_steps.status           text   not null  default 'pending'
--   form_response_steps.signature_data_url           text   null
--   form_response_steps.signed_by_person_id          uuid   null  → people.id
--   form_response_steps.signed_by_tenant_user_id     uuid   null  → tenant_users.id
--   form_response_steps.rejection_reason             text   null
--   form_response_steps.rejected_at                  timestamptz null
--   form_response_steps.rejected_by_tenant_user_id   uuid   null  → tenant_users.id
--
-- Index on (tenant_id, status) so we can quickly find pending steps when the
-- scheduled worker scans for overdue workflow assignees.

DO $$ BEGIN
  ALTER TABLE "form_responses"
    ADD COLUMN IF NOT EXISTS "workflow_state" jsonb DEFAULT NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "form_response_steps"
    ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'pending';
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "form_response_steps"
    ADD COLUMN IF NOT EXISTS "signature_data_url" text;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "form_response_steps"
    ADD COLUMN IF NOT EXISTS "signed_by_person_id" uuid;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "form_response_steps"
    ADD COLUMN IF NOT EXISTS "signed_by_tenant_user_id" uuid;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "form_response_steps"
    ADD COLUMN IF NOT EXISTS "rejection_reason" text;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "form_response_steps"
    ADD COLUMN IF NOT EXISTS "rejected_at" timestamp with time zone;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "form_response_steps"
    ADD COLUMN IF NOT EXISTS "rejected_by_tenant_user_id" uuid;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "form_response_steps"
    ADD CONSTRAINT "form_response_steps_signed_by_person_id_people_id_fk"
    FOREIGN KEY ("signed_by_person_id")
    REFERENCES "public"."people"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "form_response_steps"
    ADD CONSTRAINT "form_response_steps_signed_by_tenant_user_id_tenant_users_id_fk"
    FOREIGN KEY ("signed_by_tenant_user_id")
    REFERENCES "public"."tenant_users"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "form_response_steps"
    ADD CONSTRAINT "form_response_steps_rejected_by_tenant_user_id_tenant_users_id_fk"
    FOREIGN KEY ("rejected_by_tenant_user_id")
    REFERENCES "public"."tenant_users"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "form_response_steps_status_idx"
  ON "form_response_steps" USING btree ("tenant_id","status");
