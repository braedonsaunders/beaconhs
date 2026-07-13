-- These tables are absent from the clean baseline. Drop them once on the
-- validated pre-cutover dev database, where the retired plugin runtime may
-- have existed before it was removed from the product.
DROP TABLE IF EXISTS "plugin_events" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "plugin_runs" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "tenant_plugin_secrets" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "tenant_plugins" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "plugins" CASCADE;--> statement-breakpoint

-- The atmospheric-equipment pilot was replaced by tenant custom fields. The
-- tables were removed before cutover, but these now-unreferenced enum types
-- remained in the development database.
DROP TYPE IF EXISTS "atmospheric_sensor_status";--> statement-breakpoint
DROP TYPE IF EXISTS "atmospheric_sensor_type";
