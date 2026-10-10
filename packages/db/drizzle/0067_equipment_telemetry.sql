-- Provider-neutral supplemental tracker data. Custody and register ownership are unchanged.
CREATE TABLE IF NOT EXISTS "equipment_telemetry_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"vin" text,
	"device_serials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"device_models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"item_id" uuid,
	"bound_at" timestamp with time zone,
	"excluded" boolean DEFAULT false NOT NULL,
	"source_present" boolean DEFAULT true NOT NULL,
	"deactivated" boolean DEFAULT false NOT NULL,
	"last_reported_at" timestamp with time zone,
	"gps_valid" boolean DEFAULT false NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"location_observed_at" timestamp with time zone,
	"speed_kph" double precision,
	"engine_on" boolean,
	"address" text,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_telemetry_assets_coordinate_ck" CHECK (("equipment_telemetry_assets"."latitude" IS NULL AND "equipment_telemetry_assets"."longitude" IS NULL AND "equipment_telemetry_assets"."location_observed_at" IS NULL) OR ("equipment_telemetry_assets"."latitude" IS NOT NULL AND "equipment_telemetry_assets"."longitude" IS NOT NULL AND "equipment_telemetry_assets"."latitude" BETWEEN -90 AND 90 AND "equipment_telemetry_assets"."longitude" BETWEEN -180 AND 180 AND "equipment_telemetry_assets"."location_observed_at" IS NOT NULL)),
	CONSTRAINT "equipment_telemetry_assets_binding_ck" CHECK (("equipment_telemetry_assets"."item_id" IS NULL AND "equipment_telemetry_assets"."bound_at" IS NULL) OR ("equipment_telemetry_assets"."item_id" IS NOT NULL AND "equipment_telemetry_assets"."bound_at" IS NOT NULL AND NOT "equipment_telemetry_assets"."excluded"))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "equipment_telemetry_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"telemetry_asset_id" uuid NOT NULL,
	"item_id" uuid,
	"observed_at" timestamp with time zone NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"speed_kph" double precision,
	"engine_on" boolean,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_telemetry_observations_coordinate_ck" CHECK ("equipment_telemetry_observations"."latitude" BETWEEN -90 AND 90 AND "equipment_telemetry_observations"."longitude" BETWEEN -180 AND 180)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "equipment_telemetry_assets_tenant_id_id_ux" ON "equipment_telemetry_assets" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "equipment_telemetry_assets_external_ux" ON "equipment_telemetry_assets" USING btree ("tenant_id","connection_id","external_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "equipment_telemetry_assets_item_ux" ON "equipment_telemetry_assets" USING btree ("tenant_id","item_id") WHERE "equipment_telemetry_assets"."item_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_telemetry_assets_tenant_idx" ON "equipment_telemetry_assets" USING btree ("tenant_id","connection_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "equipment_telemetry_observations_source_ux" ON "equipment_telemetry_observations" USING btree ("tenant_id","telemetry_asset_id","observed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_telemetry_observations_item_idx" ON "equipment_telemetry_observations" USING btree ("tenant_id","item_id","observed_at");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.equipment_telemetry_assets'::regclass AND conname = 'equipment_telemetry_assets_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "equipment_telemetry_assets" ADD CONSTRAINT "equipment_telemetry_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.equipment_telemetry_assets'::regclass AND conname = 'equipment_telemetry_assets_connection_fk') THEN
    ALTER TABLE "equipment_telemetry_assets" ADD CONSTRAINT "equipment_telemetry_assets_connection_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."sync_connections"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.equipment_telemetry_assets'::regclass AND conname = 'equipment_telemetry_assets_item_fk') THEN
    ALTER TABLE "equipment_telemetry_assets" ADD CONSTRAINT "equipment_telemetry_assets_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."equipment_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.equipment_telemetry_observations'::regclass AND conname = 'equipment_telemetry_observations_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "equipment_telemetry_observations" ADD CONSTRAINT "equipment_telemetry_observations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.equipment_telemetry_observations'::regclass AND conname = 'equipment_telemetry_observations_asset_fk') THEN
    ALTER TABLE "equipment_telemetry_observations" ADD CONSTRAINT "equipment_telemetry_observations_asset_fk" FOREIGN KEY ("tenant_id","telemetry_asset_id") REFERENCES "public"."equipment_telemetry_assets"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.equipment_telemetry_observations'::regclass AND conname = 'equipment_telemetry_observations_item_fk') THEN
    ALTER TABLE "equipment_telemetry_observations" ADD CONSTRAINT "equipment_telemetry_observations_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."equipment_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
