-- Wave-7 HazID signed-report worker:
--   * Add `rendering` + `completed` to `hazid_signed_report_status` so the
--     worker can transition pending → rendering → completed / failed.
--     `generating` + `ready` are kept for backward compatibility with rows
--     written by the original builder before this worker existed.
--   * Add `completed_at` and `error_message` columns so the detail page can
--     show when a render finished and why it failed (if applicable).
--
-- Postgres requires ALTER TYPE ... ADD VALUE outside a transaction block in
-- older versions; guard with DO blocks so re-running this migration is safe.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'hazid_signed_report_status' AND e.enumlabel = 'rendering'
  ) THEN
    ALTER TYPE "public"."hazid_signed_report_status" ADD VALUE 'rendering';
  END IF;
END
$$;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'hazid_signed_report_status' AND e.enumlabel = 'completed'
  ) THEN
    ALTER TYPE "public"."hazid_signed_report_status" ADD VALUE 'completed';
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "hazid_signed_reports" ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hazid_signed_reports" ADD COLUMN IF NOT EXISTS "error_message" text;
