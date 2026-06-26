ALTER TABLE "equipment_types" DROP COLUMN IF EXISTS "requires_pre_use_inspection";--> statement-breakpoint
ALTER TABLE "equipment_items" DROP COLUMN IF EXISTS "pre_use_inspection_template_key";