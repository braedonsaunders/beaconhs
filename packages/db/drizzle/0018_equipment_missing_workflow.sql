-- Equipment "report missing" / "report found" workflow + inspection-criterion
-- required flag.
--
-- The equipment_items table already had `is_missing` and a generic
-- `last_seen_at` timestamp, but no fields to capture the formal report:
-- who filed it, the last-known date / location, free-form notes, and the
-- timestamp the asset was eventually marked found. This migration adds those
-- columns so the detail-page workflow has structured fields to render the
-- destructive-tone alert ("Reported missing on <date> by <reporter> — last
-- seen at <location>") instead of inferring from the generic last-seen
-- timestamp.
--
-- Also adds an `is_required` flag on equipment_inspection_criteria so the
-- inspection-types editor can mark individual questions optional. Default
-- TRUE so existing rows keep their legacy behaviour (all-required).
--
-- Idempotent: re-running the migration is safe.

ALTER TABLE "equipment_items"
  ADD COLUMN IF NOT EXISTS "missing_reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "equipment_items"
  ADD COLUMN IF NOT EXISTS "missing_reported_by" text;--> statement-breakpoint
ALTER TABLE "equipment_items"
  ADD COLUMN IF NOT EXISTS "missing_last_seen_at" date;--> statement-breakpoint
ALTER TABLE "equipment_items"
  ADD COLUMN IF NOT EXISTS "missing_last_seen_location" text;--> statement-breakpoint
ALTER TABLE "equipment_items"
  ADD COLUMN IF NOT EXISTS "missing_notes" text;--> statement-breakpoint
ALTER TABLE "equipment_items"
  ADD COLUMN IF NOT EXISTS "missing_found_at" timestamp with time zone;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "equipment_items"
    ADD CONSTRAINT "equipment_items_missing_reported_by_user_id_fk"
    FOREIGN KEY ("missing_reported_by")
    REFERENCES "public"."user"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

ALTER TABLE "equipment_inspection_criteria"
  ADD COLUMN IF NOT EXISTS "is_required" boolean DEFAULT true NOT NULL;
