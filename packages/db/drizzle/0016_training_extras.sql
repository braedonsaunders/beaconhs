-- Training-module add-ons.
--
--   training_course_files   — course study material (PDF / DOCX / video) tied
--                              back to the attachments table.
--   training_extra_fields   — polymorphic key/value pairs attached to
--                              training_skill / training_skill_type /
--                              training_skill_authority rows.
--
-- Everything below is idempotent; re-running the migration is a no-op.

-- ---- enums ----------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "public"."training_extra_field_owner_type" AS ENUM (
    'skill', 'skill_type', 'authority'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- ---- training_course_files ------------------------------------------------

CREATE TABLE IF NOT EXISTS "training_course_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "course_id" uuid NOT NULL,
  "attachment_id" uuid,
  "label" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "training_course_files"
    ADD CONSTRAINT "training_course_files_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "training_course_files"
    ADD CONSTRAINT "training_course_files_course_id_training_courses_id_fk"
    FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "training_course_files"
    ADD CONSTRAINT "training_course_files_attachment_id_attachments_id_fk"
    FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "training_course_files_tenant_idx" ON "training_course_files" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_course_files_course_idx" ON "training_course_files" USING btree ("course_id");--> statement-breakpoint

-- ---- training_extra_fields ------------------------------------------------

CREATE TABLE IF NOT EXISTS "training_extra_fields" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "owner_type" "training_extra_field_owner_type" NOT NULL,
  "owner_id" uuid NOT NULL,
  "field_key" text NOT NULL,
  "field_value" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "training_extra_fields"
    ADD CONSTRAINT "training_extra_fields_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "training_extra_fields_tenant_idx" ON "training_extra_fields" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_extra_fields_owner_idx" ON "training_extra_fields" USING btree ("owner_type","owner_id");
