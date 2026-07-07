-- Training slides: PPTX master copy. When source_attachment_id is set, the
-- uploaded .pptx attachment is the deck's source of truth — slides[] is a
-- derived render the worker replaces after every import/edit (Collabora save),
-- and authors edit the deck in the in-browser PowerPoint editor.

ALTER TABLE "training_lessons" ADD COLUMN IF NOT EXISTS "source_attachment_id" uuid;
--> statement-breakpoint
ALTER TABLE "training_content_items" ADD COLUMN IF NOT EXISTS "source_attachment_id" uuid;
