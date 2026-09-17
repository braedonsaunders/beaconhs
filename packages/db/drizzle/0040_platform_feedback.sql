ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "feedback" jsonb DEFAULT '{}'::jsonb NOT NULL;
