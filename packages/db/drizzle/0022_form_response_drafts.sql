-- Save-and-resume drafts for form responses.
--
-- Adds:
--   form_responses.draft_data        jsonb null   -- { values, rows } in-flight payload
--   form_responses.draft_updated_at  timestamptz null
--   form_responses.draft_step_index  int null     -- which workflow step the user was on
--
-- All additions are idempotent (ADD COLUMN IF NOT EXISTS). Safe to re-run; no
-- data is rewritten, no NOT NULL constraints are added without a default.

DO $$ BEGIN
  ALTER TABLE "form_responses"
    ADD COLUMN IF NOT EXISTS "draft_data" jsonb;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "form_responses"
    ADD COLUMN IF NOT EXISTS "draft_updated_at" timestamp with time zone;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "form_responses"
    ADD COLUMN IF NOT EXISTS "draft_step_index" integer;
END $$;--> statement-breakpoint

-- Index so we can quickly list drafts a user has in-flight in the "Resume"
-- card on the forms landing page (future feature). Cheap to create idempotently.
CREATE INDEX IF NOT EXISTS "form_responses_draft_updated_idx"
  ON "form_responses" USING btree ("tenant_id", "draft_updated_at");
