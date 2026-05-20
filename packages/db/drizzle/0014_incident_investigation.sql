-- Wave-8 incident investigation flow:
--   Five sub-tables backing the legacy 5-step investigation form on the
--   incident detail page.
--
--     incident_events                 — chronological timeline entries
--     incident_contributing_factors   — categorised cause analysis
--     incident_root_cause_whys        — optional 1–5 "5-whys" chain
--     incident_preventative_steps     — prevention items (owner + due + status)
--
--   The single-field root_cause text column on incidents stays in place; the
--   whys table is purely additive.
--
--   Everything below is idempotent so a re-run of the migration on an
--   already-populated database is a no-op.

-- ---- enums ----------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "public"."incident_factor_category" AS ENUM (
    'equipment', 'procedure', 'training', 'environment', 'human', 'other'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."incident_preventative_step_status" AS ENUM (
    'planned', 'in_progress', 'completed'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- ---- incident_events ------------------------------------------------------

CREATE TABLE IF NOT EXISTS "incident_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "incident_id" uuid NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "recorded_by_tenant_user_id" uuid,
  "description" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "incident_events"
    ADD CONSTRAINT "incident_events_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "incident_events"
    ADD CONSTRAINT "incident_events_incident_id_incidents_id_fk"
    FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "incident_events"
    ADD CONSTRAINT "incident_events_recorded_by_tenant_user_id_tenant_users_id_fk"
    FOREIGN KEY ("recorded_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "incident_events_incident_idx" ON "incident_events" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_events_tenant_idx" ON "incident_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_events_occurred_idx" ON "incident_events" USING btree ("incident_id","occurred_at");--> statement-breakpoint

-- ---- incident_contributing_factors ----------------------------------------

CREATE TABLE IF NOT EXISTS "incident_contributing_factors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "incident_id" uuid NOT NULL,
  "category" "incident_factor_category" NOT NULL,
  "description" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "incident_contributing_factors"
    ADD CONSTRAINT "incident_contributing_factors_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "incident_contributing_factors"
    ADD CONSTRAINT "incident_contributing_factors_incident_id_incidents_id_fk"
    FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "incident_contributing_factors_incident_idx" ON "incident_contributing_factors" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_contributing_factors_tenant_idx" ON "incident_contributing_factors" USING btree ("tenant_id");--> statement-breakpoint

-- ---- incident_root_cause_whys ---------------------------------------------

CREATE TABLE IF NOT EXISTS "incident_root_cause_whys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "incident_id" uuid NOT NULL,
  "ordinal" integer NOT NULL,
  "why_text" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "incident_root_cause_whys"
    ADD CONSTRAINT "incident_root_cause_whys_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "incident_root_cause_whys"
    ADD CONSTRAINT "incident_root_cause_whys_incident_id_incidents_id_fk"
    FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "incident_root_cause_whys_incident_idx" ON "incident_root_cause_whys" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_root_cause_whys_tenant_idx" ON "incident_root_cause_whys" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_root_cause_whys_incident_ordinal_idx" ON "incident_root_cause_whys" USING btree ("incident_id","ordinal");--> statement-breakpoint

-- ---- incident_preventative_steps ------------------------------------------

CREATE TABLE IF NOT EXISTS "incident_preventative_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "incident_id" uuid NOT NULL,
  "description" text NOT NULL,
  "owner_person_id" uuid,
  "target_date" date,
  "status" "incident_preventative_step_status" DEFAULT 'planned' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "incident_preventative_steps"
    ADD CONSTRAINT "incident_preventative_steps_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "incident_preventative_steps"
    ADD CONSTRAINT "incident_preventative_steps_incident_id_incidents_id_fk"
    FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "incident_preventative_steps"
    ADD CONSTRAINT "incident_preventative_steps_owner_person_id_people_id_fk"
    FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "incident_preventative_steps_incident_idx" ON "incident_preventative_steps" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_preventative_steps_tenant_idx" ON "incident_preventative_steps" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_preventative_steps_status_idx" ON "incident_preventative_steps" USING btree ("tenant_id","status");
