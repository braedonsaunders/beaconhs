-- Vehicle log settings — one row per tenant. Which entry modes the workspace
-- offers (destination / odometer / both) and the tenant-wide default mode.
-- Per-driver overrides live on people.metadata.vehicleLogMode; a missing row
-- means built-in defaults (both enabled, destination default).

CREATE TABLE IF NOT EXISTS "vehicle_log_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "enabled_modes" text DEFAULT 'both' NOT NULL,
  "default_mode" text DEFAULT 'destination' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_log_settings_uniq" ON "vehicle_log_settings" ("tenant_id");
