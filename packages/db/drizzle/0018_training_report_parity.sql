-- Canonicalize the training report catalogue. The old 30-day expiring report
-- duplicated Expired & Upcoming; preserve any schedules by moving them to the
-- configurable canonical definition before removing the duplicate.
-- The migrator assumes the NOLOGIN owner role. Temporarily relax FORCE RLS so
-- it can reconcile global definitions and schedules across every tenant; the
-- migration transaction restores FORCE before commit.
ALTER TABLE "report_definitions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_schedules" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

UPDATE "report_schedules" s
SET "definition_id" = canonical."id",
    "updated_at" = now()
FROM "report_definitions" duplicate,
     "report_definitions" canonical
WHERE duplicate."tenant_id" IS NULL
  AND duplicate."slug" = 'training_expiring_30d'
  AND canonical."tenant_id" IS NULL
  AND canonical."slug" = 'training_expired_upcoming'
  AND s."definition_id" = duplicate."id";--> statement-breakpoint

DELETE FROM "report_definitions"
WHERE "tenant_id" IS NULL
  AND "slug" = 'training_expiring_30d';--> statement-breakpoint

INSERT INTO "report_definitions"
  ("slug", "kind", "name", "description", "category", "query_kind", "custom_query")
VALUES
  (
    'training_certificates',
    'built_in',
    'Training — Certificates',
    'Held training certificates. Filter by employee, group, department, course, and delivery type; include or exclude expired records and group by employee or course.',
    'training',
    'training_certificates',
    NULL
  ),
  (
    'training_expired_upcoming',
    'built_in',
    'Training — Expired & Upcoming',
    'Expired certificates and certificates expiring within a selectable 30–365 day window. Filter people and courses, then group by employee or course.',
    'training',
    'training_expired_upcoming',
    NULL
  ),
  (
    'training_missing',
    'built_in',
    'Training — Missing',
    'Assigned course requirements that are missing, expired, or expiring. Filter people and courses, then group by employee or course.',
    'training',
    'training_missing',
    NULL
  )
ON CONFLICT ("slug") WHERE "tenant_id" IS NULL
DO UPDATE SET
  "kind" = EXCLUDED."kind",
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "category" = EXCLUDED."category",
  "query_kind" = EXCLUDED."query_kind",
  "custom_query" = EXCLUDED."custom_query",
  "updated_at" = now();--> statement-breakpoint

ALTER TABLE "report_schedules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_definitions" FORCE ROW LEVEL SECURITY;
