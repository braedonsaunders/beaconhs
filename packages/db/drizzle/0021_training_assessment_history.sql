-- Imported legacy quiz attempts carry an explicit provenance sentence in
-- notes. Their source stored only a completion date, not a trustworthy elapsed
-- duration, and open sessions were closed at cutover without being completed.
-- Keep the historical start, preserve the source completion day, and restore
-- the canonical lifecycle invariants used by the modern assessment UI.
ALTER TABLE "training_assessments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

UPDATE "training_assessments"
SET "completed_at" = NULL,
    "submitted_at" = NULL
WHERE "status" = 'cancelled'
  AND "notes" LIKE 'Migrated legacy quiz attempt.%'
  AND ("completed_at" IS NOT NULL OR "submitted_at" IS NOT NULL);--> statement-breakpoint

UPDATE "training_assessments"
SET "completed_at" = GREATEST("completed_at", "started_at"),
    "submitted_at" = GREATEST(COALESCE("submitted_at", "completed_at"), "started_at")
WHERE "status" = 'submitted'
  AND "notes" LIKE 'Migrated legacy quiz attempt.%'
  AND (
    "completed_at" < "started_at"
    OR "submitted_at" IS NULL
    OR "submitted_at" < "started_at"
  );--> statement-breakpoint

ALTER TABLE "training_assessments" FORCE ROW LEVEL SECURITY;
