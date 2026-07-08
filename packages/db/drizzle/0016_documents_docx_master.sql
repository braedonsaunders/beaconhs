-- Documents cutover to DOCX masters (Collabora Writer is THE editor).
--
-- documents.source_attachment_id: the working .docx (page setup, comments and
-- track changes live in the file). document_versions gains the immutable
-- publish artifacts: DOCX snapshot, worker-rendered PDF, extracted text.
-- The TipTap draft/comments subsystem and inline HTML content are removed
-- (existing content was converted to DOCX/PDF by the one-time migration
-- before this DDL ran).

ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "source_attachment_id" uuid;
--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN IF NOT EXISTS "docx_attachment_id" uuid;
--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN IF NOT EXISTS "pdf_attachment_id" uuid;
--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN IF NOT EXISTS "text_content" text;
--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN IF NOT EXISTS "render_status" text;
--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN IF NOT EXISTS "render_error" text;
--> statement-breakpoint
DROP TABLE IF EXISTS "document_comments";
--> statement-breakpoint
DROP TABLE IF EXISTS "document_drafts";
--> statement-breakpoint
ALTER TABLE "document_versions" DROP COLUMN IF EXISTS "content_markdown";
--> statement-breakpoint
ALTER TABLE "document_versions" DROP COLUMN IF EXISTS "content_json";
--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN IF EXISTS "print_header";
--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN IF EXISTS "print_footer";
--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN IF EXISTS "page_size";
--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN IF EXISTS "header_text";
--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN IF EXISTS "footer_text";
