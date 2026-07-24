-- Replace the removed product-specific lone-worker naming with the generic
-- monitored-session/App Builder vocabulary and repair managed Insight cards
-- that still reference the retired raw form_responses source key.

UPDATE "insight_cards"
SET
  "query" = jsonb_set(
    "query",
    '{stages,0,source}',
    to_jsonb('app_responses'::text),
    false
  ),
  "updated_at" = now()
WHERE "created_by" IS NULL
  AND "query" #>> '{stages,0,source}' = 'form_responses';
--> statement-breakpoint

UPDATE "report_definitions"
SET
  "seed_key" = 'monitored_sessions_weekly',
  "slug" = CASE
    WHEN EXISTS (
      SELECT 1
      FROM "report_definitions" AS conflict
      WHERE conflict."tenant_id" = "report_definitions"."tenant_id"
        AND conflict."id" <> "report_definitions"."id"
        AND conflict."slug" = 'monitored-sessions-weekly'
    )
      THEN 'monitored-sessions-weekly-' || left("id"::text, 8)
    ELSE 'monitored-sessions-weekly'
  END,
  "category" = 'apps',
  "tags" = replace("tags"::text, '"lone_worker"', '"apps"')::jsonb,
  "updated_at" = now()
WHERE "seed_key" = 'lone_worker_weekly';
--> statement-breakpoint

UPDATE "form_templates"
SET "category" = 'monitored_session', "updated_at" = now()
WHERE "category" = 'lone_worker';
--> statement-breakpoint

UPDATE "notifications"
SET "category" = 'monitored_session'
WHERE "category" = 'lone_worker';
--> statement-breakpoint

DELETE FROM "notification_preferences" AS legacy
USING "notification_preferences" AS current
WHERE legacy."category" = 'lone_worker'
  AND current."category" = 'monitored_session'
  AND current."tenant_id" = legacy."tenant_id"
  AND current."user_id" = legacy."user_id"
  AND current."channel" = legacy."channel";
--> statement-breakpoint

UPDATE "notification_preferences"
SET "category" = 'monitored_session', "updated_at" = now()
WHERE "category" = 'lone_worker';
--> statement-breakpoint

DELETE FROM "tenant_notification_settings" AS legacy
USING "tenant_notification_settings" AS current
WHERE legacy."category" = 'lone_worker'
  AND current."category" = 'monitored_session'
  AND current."tenant_id" = legacy."tenant_id";
--> statement-breakpoint

UPDATE "tenant_notification_settings"
SET "category" = 'monitored_session', "updated_at" = now()
WHERE "category" = 'lone_worker';
--> statement-breakpoint

UPDATE "email_log"
SET "category_key" = 'monitored_session'
WHERE "category_key" = 'lone_worker';
--> statement-breakpoint

UPDATE "user_dashboard_layouts"
SET
  "layout" = replace(
    "layout"::text,
    '"op-lone-worker-active"',
    '"op-monitored-sessions-active"'
  )::jsonb,
  "updated_at" = now()
WHERE "layout"::text LIKE '%op-lone-worker-active%';
--> statement-breakpoint

UPDATE "role_dashboard_layouts"
SET
  "layout" = replace(
    "layout"::text,
    '"op-lone-worker-active"',
    '"op-monitored-sessions-active"'
  )::jsonb,
  "updated_at" = now()
WHERE "layout"::text LIKE '%op-lone-worker-active%';
--> statement-breakpoint

UPDATE "insight_dashboards"
SET
  "layout" = replace(
    replace(
      "layout"::text,
      '"kpi-lw-active"',
      '"kpi-monitored-sessions-active"'
    ),
    '"op-lone-worker-active"',
    '"op-monitored-sessions-active"'
  )::jsonb,
  "updated_at" = now()
WHERE "layout"::text LIKE '%kpi-lw-active%'
   OR "layout"::text LIKE '%op-lone-worker-active%';
