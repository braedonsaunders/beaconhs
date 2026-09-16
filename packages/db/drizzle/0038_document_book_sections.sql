-- Book sections: a book is an ordered list of ENTRIES, most of which point at a
-- document. A `section` entry carries only a heading and divides the manual —
-- the legacy books had Chapter entries and a 196-document book with no
-- dividers is unusable.
--
-- `document_id` becomes nullable because a section has none. The composite
-- foreign key is MATCH SIMPLE, so a null document is simply not checked.
DO $$ BEGIN
  CREATE TYPE "public"."document_book_item_kind" AS ENUM('document', 'section');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

ALTER TABLE "document_book_items"
  ADD COLUMN IF NOT EXISTS "kind" "public"."document_book_item_kind" DEFAULT 'document' NOT NULL;--> statement-breakpoint

ALTER TABLE "document_book_items" ADD COLUMN IF NOT EXISTS "title" text;--> statement-breakpoint

ALTER TABLE "document_book_items" ALTER COLUMN "document_id" DROP NOT NULL;--> statement-breakpoint

-- A document still appears at most once per book, but a book may hold many
-- sections, so the uniqueness rule only covers document entries.
DROP INDEX IF EXISTS "document_book_items_book_doc_ux";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_book_items_book_doc_ux"
  ON "document_book_items" ("book_id", "document_id")
  WHERE "document_id" IS NOT NULL;
