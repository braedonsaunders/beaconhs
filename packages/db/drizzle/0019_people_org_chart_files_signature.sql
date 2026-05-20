-- People parity gap closure: org chart, per-person files, user signature.
--
-- 1. people.manager_person_id — self-referential reporting line. Nullable for
--    top-level reports (executives, contractors without a manager). The
--    org-chart page builds a tree from this column with a simple in-memory
--    cycle guard.
--
-- 2. people.signature_attachment_id — references the user's saved signature
--    image. Inspections, lift plans, and form sign-offs render this inline
--    when the person signs. Stored as a regular attachment so it benefits
--    from the same upload + audit pipeline.
--
-- 3. person_files — per-person attachment index for resumes, certifications,
--    ID copies, etc. CASCADE deletes when the person is purged. The
--    underlying attachment row is preserved (SET NULL on attachment delete)
--    so audit history can still reference it.
--
-- Idempotent: re-running the migration is safe.

ALTER TABLE "people"
  ADD COLUMN IF NOT EXISTS "manager_person_id" uuid;--> statement-breakpoint
ALTER TABLE "people"
  ADD COLUMN IF NOT EXISTS "signature_attachment_id" uuid;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "people"
    ADD CONSTRAINT "people_manager_person_id_people_id_fk"
    FOREIGN KEY ("manager_person_id")
    REFERENCES "public"."people"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "people_manager_idx"
  ON "people" USING btree ("tenant_id", "manager_person_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "person_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "person_id" uuid NOT NULL,
  "attachment_id" uuid,
  "label" text NOT NULL,
  "kind" text NOT NULL,
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "uploaded_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "person_files"
    ADD CONSTRAINT "person_files_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id")
    REFERENCES "public"."tenants"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "person_files"
    ADD CONSTRAINT "person_files_person_id_people_id_fk"
    FOREIGN KEY ("person_id")
    REFERENCES "public"."people"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "person_files"
    ADD CONSTRAINT "person_files_attachment_id_attachments_id_fk"
    FOREIGN KEY ("attachment_id")
    REFERENCES "public"."attachments"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "person_files"
    ADD CONSTRAINT "person_files_uploaded_by_user_id_fk"
    FOREIGN KEY ("uploaded_by")
    REFERENCES "public"."user"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "person_files_tenant_idx"
  ON "person_files" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_files_person_idx"
  ON "person_files" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_files_kind_idx"
  ON "person_files" USING btree ("tenant_id", "kind");
