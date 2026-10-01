ALTER TABLE "tenant_users" ADD COLUMN IF NOT EXISTS "removed_at" timestamp with time zone;
