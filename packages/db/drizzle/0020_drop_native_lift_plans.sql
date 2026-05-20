-- Drop the native lift-plans module.
--
-- Lift plans are now a per-tenant form template (category='lift_plan',
-- moduleBinding='lift_plan'), seeded by packages/db/src/seed/lift-plan-template.ts.
-- The app surfaces them at /inspections?bound=lift_plan — there is no longer
-- a /lift-plans route, no liftPlans drizzle table, no lift_plan_* sub-tables.
--
-- The app has not launched yet, so this is a hard delete with no preservation
-- path. CASCADE nukes any FK constraints that point at these tables (e.g.
-- audit_log entries, attachment links via attachmentId).

DROP TABLE IF EXISTS "lift_plan_checklist_items" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "lift_plan_photos" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "lift_plan_signatures" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "lift_plan_ppe" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "lift_plan_hazards" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "lift_plan_equipment" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "lift_plan_loads" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "lift_plans" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."lift_plan_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."lift_plan_signature_role";
