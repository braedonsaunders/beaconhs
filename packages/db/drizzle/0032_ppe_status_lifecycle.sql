-- PPE status lifecycle: an item that fails an inspection goes out of service
-- (keeping its holder) and only a passing inspection by someone holding
-- ppe.return_to_service can clear it.
--
-- 'damaged' / 'mark_damaged' are RENAMED rather than supplemented: both had
-- zero rows, and an out_of_service state living alongside a damaged one would
-- be two names for the same thing.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ppe_item_status' AND e.enumlabel = 'damaged'
  ) THEN
    ALTER TYPE "ppe_item_status" RENAME VALUE 'damaged' TO 'out_of_service';
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ppe_issue_action' AND e.enumlabel = 'mark_damaged'
  ) THEN
    ALTER TYPE "ppe_issue_action" RENAME VALUE 'mark_damaged' TO 'mark_out_of_service';
  END IF;
END $$;--> statement-breakpoint

-- Every status transition needs a representable ledger action so the History
-- tab can always name who changed it. return_to_stock and expire previously
-- flipped the column with no ledger row at all.
ALTER TYPE "ppe_issue_action" ADD VALUE IF NOT EXISTS 'return_to_service';--> statement-breakpoint
ALTER TYPE "ppe_issue_action" ADD VALUE IF NOT EXISTS 'return_to_stock';--> statement-breakpoint
ALTER TYPE "ppe_issue_action" ADD VALUE IF NOT EXISTS 'expire';--> statement-breakpoint

-- Denormalised from the newest ledger row: updated_at moves on any write, so
-- it cannot back a "recently changed status" sort.
ALTER TABLE "ppe_items" ADD COLUMN IF NOT EXISTS "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ppe_items" ADD COLUMN IF NOT EXISTS "status_changed_by_tenant_user_id" uuid;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ppe_items_tenant_status_changed_by_fk'
  ) THEN
    ALTER TABLE "ppe_items"
      ADD CONSTRAINT "ppe_items_tenant_status_changed_by_fk"
      FOREIGN KEY ("tenant_id", "status_changed_by_tenant_user_id")
      REFERENCES "tenant_users"("tenant_id", "id");
  END IF;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ppe_items_status_changed_idx"
  ON "ppe_items" ("tenant_id", "status_changed_at");--> statement-breakpoint

-- Supervisor who oversaw the check. A person, not a tenant user: the foreman
-- named by a crew often has no login.
ALTER TABLE "ppe_inspections" ADD COLUMN IF NOT EXISTS "supervisor_person_id" uuid;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ppe_inspections_tenant_supervisor_fk'
  ) THEN
    ALTER TABLE "ppe_inspections"
      ADD CONSTRAINT "ppe_inspections_tenant_supervisor_fk"
      FOREIGN KEY ("tenant_id", "supervisor_person_id")
      REFERENCES "people"("tenant_id", "id");
  END IF;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ppe_inspections_supervisor_idx"
  ON "ppe_inspections" ("tenant_id", "supervisor_person_id");--> statement-breakpoint

-- Backfill so the new sort is meaningful for existing rows: the newest ledger
-- entry is the best available record of when an item's status last moved.
UPDATE "ppe_items" AS i
SET "status_changed_at" = latest."occurred_at",
    "status_changed_by_tenant_user_id" = latest."issued_by_tenant_user_id"
FROM (
  SELECT DISTINCT ON ("item_id")
         "item_id", "occurred_at", "issued_by_tenant_user_id"
  FROM "ppe_issues"
  ORDER BY "item_id", "occurred_at" DESC, "id" DESC
) AS latest
WHERE latest."item_id" = i."id" AND i."status_changed_at" IS NULL;
