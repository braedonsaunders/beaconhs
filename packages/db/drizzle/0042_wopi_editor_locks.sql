-- Collabora save ordering. The lock is the editing session; the tickets
-- order overlapping autosave and publish uploads. Lock refreshes must not
-- bump updated_at (the application writes these columns with raw SQL) because
-- Collabora treats that timestamp as the file version.
ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "wopi_lock" text;
ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "wopi_lock_expires_at" timestamp with time zone;
ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "wopi_save_ticket" bigint DEFAULT 0 NOT NULL;
ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "wopi_applied_ticket" bigint DEFAULT 0 NOT NULL;
