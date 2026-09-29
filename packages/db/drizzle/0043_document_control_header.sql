ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "show_document_header" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN IF NOT EXISTS "control_header" jsonb;
--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN IF NOT EXISTS "body_pdf_attachment_id" uuid;
--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN IF NOT EXISTS "book_pdf_attachment_id" uuid;
--> statement-breakpoint
-- Existing authored PDFs have no printed table and already reserve the book band.
-- Register those derived artifacts; future renders produce both body layouts.
UPDATE "document_versions" SET
  "body_pdf_attachment_id" = "pdf_attachment_id",
  "book_pdf_attachment_id" = "pdf_attachment_id"
WHERE "docx_attachment_id" IS NOT NULL AND "pdf_attachment_id" IS NOT NULL
  AND "body_pdf_attachment_id" IS NULL AND "book_pdf_attachment_id" IS NULL;

--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'att_tenant_document_versions_body_pdf_attachment_id_ccd200e4') THEN
    ALTER TABLE "document_versions"
      ADD CONSTRAINT "att_tenant_document_versions_body_pdf_attachment_id_ccd200e4"
      FOREIGN KEY ("tenant_id", "body_pdf_attachment_id")
      REFERENCES "attachments" ("tenant_id", "id")
      ON DELETE SET NULL ("body_pdf_attachment_id")
      NOT VALID;
  END IF;
END $$;
ALTER TABLE "document_versions" VALIDATE CONSTRAINT "att_tenant_document_versions_body_pdf_attachment_id_ccd200e4";

--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'att_tenant_document_versions_book_pdf_attachment_id_67e7ca71') THEN
    ALTER TABLE "document_versions"
      ADD CONSTRAINT "att_tenant_document_versions_book_pdf_attachment_id_67e7ca71"
      FOREIGN KEY ("tenant_id", "book_pdf_attachment_id")
      REFERENCES "attachments" ("tenant_id", "id")
      ON DELETE SET NULL ("book_pdf_attachment_id")
      NOT VALID;
  END IF;
END $$;
ALTER TABLE "document_versions" VALIDATE CONSTRAINT "att_tenant_document_versions_book_pdf_attachment_id_67e7ca71";
