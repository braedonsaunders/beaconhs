-- Equipment maintenance overhaul.
--
-- 1. Inspection cadences go fully flexible: the daily/annual-style enum on
--    equipment_inspection_types becomes an "every N day/week/month/year"
--    value + unit pair (plus an explicit pre-use flag), and per-unit cadences
--    move into a new equipment_inspection_schedules table so one asset can
--    carry daily + monthly + 3-month + annual + 5-year schedules at once.
-- 2. equipment_items gains best-practice register fields (manufacture,
--    acquisition incl. purchase price, ownership, road/registration, meters,
--    specifications) — purchase price is informational only; all other
--    financials stay external.
-- 3. equipment_reminders: ad-hoc, optionally repeating maintenance to-dos.
-- 4. equipment_categories.enabled_field_groups + custom_field_definitions
--    .group_key drive the per-category field-group layout on the record page.
--
-- Idempotent: guarded types, ADD/DROP COLUMN IF (NOT) EXISTS, backfills keyed
-- on the presence of the legacy columns, NO FORCE/FORCE RLS around data moves.

DO $$ BEGIN
  CREATE TYPE "equipment_interval_unit" AS ENUM ('day', 'week', 'month', 'year');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "equipment_ownership" AS ENUM ('owned', 'rented', 'leased');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ---- Inspection types: enum interval -> value + unit + pre-use flag --------
ALTER TABLE "equipment_inspection_types"
  ADD COLUMN IF NOT EXISTS "interval_value" integer,
  ADD COLUMN IF NOT EXISTS "interval_unit" "equipment_interval_unit",
  ADD COLUMN IF NOT EXISTS "is_pre_use" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'equipment_inspection_types' AND column_name = 'interval'
  ) THEN
    ALTER TABLE "equipment_inspection_types" NO FORCE ROW LEVEL SECURITY;
    UPDATE "equipment_inspection_types" SET
      "interval_value" = CASE "interval"::text
        WHEN 'daily' THEN 1
        WHEN 'weekly' THEN 1
        WHEN 'monthly' THEN 1
        WHEN 'quarterly' THEN 3
        WHEN 'annually' THEN 1
        WHEN 'five_year' THEN 5
        ELSE NULL END,
      "interval_unit" = (CASE "interval"::text
        WHEN 'daily' THEN 'day'
        WHEN 'weekly' THEN 'week'
        WHEN 'monthly' THEN 'month'
        WHEN 'quarterly' THEN 'month'
        WHEN 'annually' THEN 'year'
        WHEN 'five_year' THEN 'year'
        ELSE NULL END)::"equipment_interval_unit",
      "is_pre_use" = ("interval"::text = 'pre_use');
    ALTER TABLE "equipment_inspection_types" DROP COLUMN "interval";
    ALTER TABLE "equipment_inspection_types" FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
--> statement-breakpoint

-- ---- Inspection records: enum snapshot -> display label --------------------
ALTER TABLE "equipment_inspection_records" ADD COLUMN IF NOT EXISTS "interval_label" text;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'equipment_inspection_records' AND column_name = 'interval_snapshot'
  ) THEN
    ALTER TABLE "equipment_inspection_records" NO FORCE ROW LEVEL SECURITY;
    UPDATE "equipment_inspection_records" SET "interval_label" = CASE "interval_snapshot"::text
      WHEN 'pre_use' THEN 'Pre-use'
      WHEN 'daily' THEN 'Daily'
      WHEN 'weekly' THEN 'Weekly'
      WHEN 'monthly' THEN 'Monthly'
      WHEN 'quarterly' THEN 'Every 3 months'
      WHEN 'annually' THEN 'Annual'
      WHEN 'five_year' THEN 'Every 5 years'
      WHEN 'on_demand' THEN 'On demand'
      ELSE NULL END
    WHERE "interval_snapshot" IS NOT NULL AND "interval_label" IS NULL;
    ALTER TABLE "equipment_inspection_records" DROP COLUMN "interval_snapshot";
    ALTER TABLE "equipment_inspection_records" FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
--> statement-breakpoint
DROP TYPE IF EXISTS "equipment_inspection_interval";
--> statement-breakpoint

-- ---- Per-unit inspection schedules ------------------------------------------
CREATE TABLE IF NOT EXISTS "equipment_inspection_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"equipment_item_id" uuid NOT NULL,
	"inspection_type_id" uuid,
	"label" text,
	"interval_value" integer NOT NULL,
	"interval_unit" "equipment_interval_unit" NOT NULL,
	"last_completed_on" date,
	"next_due_on" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "equipment_inspection_schedules" ADD CONSTRAINT "equipment_inspection_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "equipment_inspection_schedules" ADD CONSTRAINT "equipment_inspection_schedules_equipment_item_id_equipment_items_id_fk" FOREIGN KEY ("equipment_item_id") REFERENCES "public"."equipment_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "equipment_inspection_schedules" ADD CONSTRAINT "equipment_inspection_schedules_inspection_type_id_equipment_inspection_types_id_fk" FOREIGN KEY ("inspection_type_id") REFERENCES "public"."equipment_inspection_types"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "equipment_inspection_schedules" ADD CONSTRAINT "equipment_inspection_schedules_created_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("created_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_inspection_schedules_tenant_due_idx" ON "equipment_inspection_schedules" USING btree ("tenant_id","next_due_on");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_inspection_schedules_item_idx" ON "equipment_inspection_schedules" USING btree ("equipment_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_inspection_schedules_type_idx" ON "equipment_inspection_schedules" USING btree ("tenant_id","inspection_type_id");
--> statement-breakpoint

-- ---- Backfill schedules from the legacy per-item annual columns, then drop --
-- report_equipment_fleet projects the legacy columns; drop it first so the
-- column drops succeed. Every migrate re-creates it from REPORT_VIEWS_SQL.
DROP VIEW IF EXISTS "report_equipment_fleet";
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'equipment_items' AND column_name = 'requires_annual_inspection'
  ) THEN
    ALTER TABLE "equipment_items" NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE "equipment_inspection_schedules" NO FORCE ROW LEVEL SECURITY;
    INSERT INTO "equipment_inspection_schedules"
      ("tenant_id", "equipment_item_id", "label", "interval_value", "interval_unit",
       "last_completed_on", "next_due_on", "is_active")
    SELECT i."tenant_id", i."id", 'Annual inspection', 1, 'year',
           i."last_annual_inspection_on",
           COALESCE(i."next_annual_inspection_due",
                    (i."last_annual_inspection_on" + interval '1 year')::date,
                    (CURRENT_DATE + interval '1 year')::date),
           true
    FROM "equipment_items" i
    WHERE i."requires_annual_inspection" = true
      AND i."deleted_at" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "equipment_inspection_schedules" s
        WHERE s."equipment_item_id" = i."id" AND s."label" = 'Annual inspection'
      );
    ALTER TABLE "equipment_items" DROP COLUMN "requires_annual_inspection";
    ALTER TABLE "equipment_items" DROP COLUMN IF EXISTS "last_annual_inspection_on";
    ALTER TABLE "equipment_items" DROP COLUMN IF EXISTS "next_annual_inspection_due";
    ALTER TABLE "equipment_items" FORCE ROW LEVEL SECURITY;
    ALTER TABLE "equipment_inspection_schedules" FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
--> statement-breakpoint

-- ---- New asset-register fields ----------------------------------------------
ALTER TABLE "equipment_items"
  ADD COLUMN IF NOT EXISTS "manufacturer" text,
  ADD COLUMN IF NOT EXISTS "model" text,
  ADD COLUMN IF NOT EXISTS "model_year" integer,
  ADD COLUMN IF NOT EXISTS "purchase_price" numeric(12, 2),
  ADD COLUMN IF NOT EXISTS "purchase_vendor" text,
  ADD COLUMN IF NOT EXISTS "ownership" "equipment_ownership" DEFAULT 'owned' NOT NULL,
  ADD COLUMN IF NOT EXISTS "rental_provider" text,
  ADD COLUMN IF NOT EXISTS "rental_ends_on" date,
  ADD COLUMN IF NOT EXISTS "vin" text,
  ADD COLUMN IF NOT EXISTS "license_plate" text,
  ADD COLUMN IF NOT EXISTS "registration_expires_on" date,
  ADD COLUMN IF NOT EXISTS "insurance_expires_on" date,
  ADD COLUMN IF NOT EXISTS "current_hours" numeric(10, 1),
  ADD COLUMN IF NOT EXISTS "current_odometer" integer,
  ADD COLUMN IF NOT EXISTS "meters_updated_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "fuel_type" text,
  ADD COLUMN IF NOT EXISTS "power_rating" text,
  ADD COLUMN IF NOT EXISTS "capacity" text,
  ADD COLUMN IF NOT EXISTS "weight" text,
  ADD COLUMN IF NOT EXISTS "dimensions" text;
--> statement-breakpoint

-- ---- Category field-group toggles + custom-field native placement ----------
ALTER TABLE "equipment_categories" ADD COLUMN IF NOT EXISTS "enabled_field_groups" jsonb;
--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "group_key" text;
--> statement-breakpoint

-- ---- Ad-hoc maintenance reminders -------------------------------------------
CREATE TABLE IF NOT EXISTS "equipment_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"equipment_item_id" uuid NOT NULL,
	"title" text NOT NULL,
	"details" text,
	"due_on" date NOT NULL,
	"repeat_interval_value" integer,
	"repeat_interval_unit" "equipment_interval_unit",
	"assigned_to_person_id" uuid,
	"completed_at" timestamp with time zone,
	"completed_by_tenant_user_id" uuid,
	"created_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "equipment_reminders" ADD CONSTRAINT "equipment_reminders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "equipment_reminders" ADD CONSTRAINT "equipment_reminders_equipment_item_id_equipment_items_id_fk" FOREIGN KEY ("equipment_item_id") REFERENCES "public"."equipment_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "equipment_reminders" ADD CONSTRAINT "equipment_reminders_assigned_to_person_id_people_id_fk" FOREIGN KEY ("assigned_to_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "equipment_reminders" ADD CONSTRAINT "equipment_reminders_completed_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("completed_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "equipment_reminders" ADD CONSTRAINT "equipment_reminders_created_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("created_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_reminders_tenant_due_idx" ON "equipment_reminders" USING btree ("tenant_id","due_on");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_reminders_item_idx" ON "equipment_reminders" USING btree ("equipment_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_reminders_open_idx" ON "equipment_reminders" USING btree ("tenant_id","completed_at");
