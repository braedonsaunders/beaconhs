-- Reports print-first cutover: per-definition page setup + drop stored chart
-- config (charts were removed from the report engine — visuals live in
-- Insights). Idempotent: safe on push-managed databases too.
ALTER TABLE "report_definitions" ADD COLUMN IF NOT EXISTS "layout" jsonb;
--> statement-breakpoint
UPDATE "report_definitions"
  SET "custom_query" = "custom_query" - 'chart'
  WHERE "custom_query" ? 'chart';
