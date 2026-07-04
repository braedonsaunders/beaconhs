-- Equipment maintenance notifications + per-unit pre-use checklist.
--
-- 1. due_notified_for stamps on equipment_inspection_schedules and
--    equipment_reminders: the maintenance scan alerts once per due cycle
--    (stamp ≠ due date) instead of re-spamming every scan while overdue.
-- 2. equipment_items.pre_use_inspection_type_id: the pre-use checklist a unit
--    performs (FK to equipment_inspection_types, SET NULL on type delete).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + guarded constraint.

ALTER TABLE "equipment_inspection_schedules" ADD COLUMN IF NOT EXISTS "due_notified_for" date;
--> statement-breakpoint
ALTER TABLE "equipment_reminders" ADD COLUMN IF NOT EXISTS "due_notified_for" date;
--> statement-breakpoint
ALTER TABLE "equipment_items" ADD COLUMN IF NOT EXISTS "pre_use_inspection_type_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_pre_use_inspection_type_id_fk" FOREIGN KEY ("pre_use_inspection_type_id") REFERENCES "public"."equipment_inspection_types"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
