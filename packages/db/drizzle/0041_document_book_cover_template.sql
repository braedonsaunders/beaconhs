-- A book's cover is chosen per book: a safety manual and a safety-talk
-- compendium want different covers, so one tenant-wide default was never right
-- for both. NULL keeps the generated cover.
ALTER TABLE "document_books" ADD COLUMN IF NOT EXISTS "cover_template_id" uuid;

-- Composite target, so the reference below cannot cross tenants.
CREATE UNIQUE INDEX IF NOT EXISTS "pdf_templates_tenant_id_id_ux"
  ON "pdf_templates" ("tenant_id", "id");

DO $$
BEGIN
  ALTER TABLE "document_books"
    ADD CONSTRAINT "document_books_tenant_cover_template_fk"
    FOREIGN KEY ("tenant_id", "cover_template_id")
    REFERENCES "public"."pdf_templates"("tenant_id", "id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
