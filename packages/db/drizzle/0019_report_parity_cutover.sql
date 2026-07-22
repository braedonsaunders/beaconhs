-- These tables already enforce FORCE RLS in an upgraded environment. The
-- migrator assumes their NOLOGIN owner role, so relax FORCE transactionally
-- while reconciling all tenants and global system definitions.
ALTER TABLE "training_courses" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_definitions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_schedules" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "training_courses" ADD COLUMN IF NOT EXISTS "course_type" text;--> statement-breakpoint

UPDATE "training_courses"
SET "course_type" = NULLIF(btrim("metadata"->>'type'), '')
WHERE "course_type" IS NULL
  AND NULLIF(btrim("metadata"->>'type'), '') IS NOT NULL;--> statement-breakpoint

-- Older tenant seeds could leave a tenant-owned built-in beside the canonical
-- global definition. Move subscriptions first, then remove only those system
-- rows; tenant-created custom reports are never touched.
UPDATE "report_schedules" AS schedule
SET "definition_id" = canonical."id",
    "updated_at" = now()
FROM "report_definitions" AS duplicate,
     "report_definitions" AS canonical
WHERE duplicate."tenant_id" = schedule."tenant_id"
  AND duplicate."kind" = 'built_in'
  AND canonical."tenant_id" IS NULL
  AND canonical."slug" = duplicate."slug"
  AND schedule."definition_id" = duplicate."id";--> statement-breakpoint

DELETE FROM "report_definitions" AS duplicate
USING "report_definitions" AS canonical
WHERE duplicate."tenant_id" IS NOT NULL
  AND duplicate."kind" = 'built_in'
  AND canonical."tenant_id" IS NULL
  AND canonical."slug" = duplicate."slug";--> statement-breakpoint

-- The person × course matrix is now a native pivot Insights card. Reports must
-- not retain a second flat-document implementation or schedules targeting it.
DELETE FROM "report_schedules"
WHERE "definition_id" IN (
  SELECT "id" FROM "report_definitions"
  WHERE "tenant_id" IS NULL AND "slug" = 'training_certificate_matrix'
);--> statement-breakpoint

DELETE FROM "report_definitions"
WHERE "tenant_id" IS NULL AND "slug" = 'training_certificate_matrix';--> statement-breakpoint

UPDATE "report_definitions"
SET "query_kind" = CASE "slug"
      WHEN 'skills_matrix' THEN 'skills_matrix'
      WHEN 'skills_expired_upcoming' THEN 'skills_expired_upcoming'
      WHEN 'skills_cwb' THEN 'skills_cwb'
      WHEN 'corrective_actions_list' THEN 'corrective_actions_list'
      WHEN 'ppe_list' THEN 'ppe_list'
      WHEN 'ppe_expired_upcoming' THEN 'ppe_expired_upcoming'
      ELSE "query_kind"
    END,
    "custom_query" = NULL,
    "updated_at" = now()
WHERE "tenant_id" IS NULL
  AND "slug" IN (
    'skills_matrix',
    'skills_expired_upcoming',
    'skills_cwb',
    'corrective_actions_list',
    'ppe_list',
    'ppe_expired_upcoming'
  );--> statement-breakpoint

ALTER TABLE "report_schedules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_definitions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_courses" FORCE ROW LEVEL SECURITY;
