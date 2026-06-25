-- Drop the orphaned atmospheric-sensor calibration register. These tables backed
-- the removed native Confined Space module (see 0001); the confined-space entry
-- workflow now lives in the hazid Builder app, and no code reads/writes these.
-- Idempotent (IF EXISTS) because existing DBs are push-managed and may already
-- have had them dropped by `db:push`; this file only rebuilds fresh DBs cleanly.
DROP TABLE IF EXISTS "atmospheric_calibrations" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "atmospheric_sensors" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."atmospheric_sensor_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."atmospheric_sensor_type";
