-- Equipment types shed their legacy per-type cadence fields. Inspection
-- cadences live on equipment_inspection_schedules (per unit) with defaults on
-- equipment_inspection_types; oil-change tracking lives on equipment_items.
-- Nothing read these columns — they were write-only leftovers.

ALTER TABLE "equipment_types" DROP COLUMN IF EXISTS "inspection_schedule";
--> statement-breakpoint
ALTER TABLE "equipment_types" DROP COLUMN IF EXISTS "default_oil_change_interval_months";
