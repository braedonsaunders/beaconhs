CREATE TYPE "public"."training_assessment_review_status" AS ENUM('not_required', 'pending', 'completed');--> statement-breakpoint
ALTER TABLE "training_assessment_results" ADD COLUMN "help_text_snapshot" text;--> statement-breakpoint
ALTER TABLE "training_assessment_results" ADD COLUMN "review_notes" text;--> statement-breakpoint
ALTER TABLE "training_assessments" ADD COLUMN "graded" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "training_assessments" ADD COLUMN "review_status" "training_assessment_review_status" DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "training_assessments" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "training_assessments" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "training_assessments" ADD COLUMN "reviewed_by_tenant_user_id" uuid;--> statement-breakpoint
ALTER TABLE "training_assessments" ADD CONSTRAINT "training_assessments_tenant_reviewed_by_fk" FOREIGN KEY ("tenant_id","reviewed_by_tenant_user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_assessments_review_status_idx" ON "training_assessments" USING btree ("tenant_id","review_status");--> statement-breakpoint
CREATE INDEX "training_assessments_reviewed_by_idx" ON "training_assessments" USING btree ("tenant_id","reviewed_by_tenant_user_id");--> statement-breakpoint
UPDATE "training_assessments" AS assessment
SET "graded" = assessment_type."graded"
FROM "training_assessment_types" AS assessment_type
WHERE assessment."tenant_id" = assessment_type."tenant_id"
  AND assessment."type_id" = assessment_type."id";--> statement-breakpoint
UPDATE "training_assessment_results" AS result
SET "help_text_snapshot" = question."help_text"
FROM "training_assessment_type_questions" AS question
WHERE result."tenant_id" = question."tenant_id"
  AND result."question_id" = question."id";--> statement-breakpoint
UPDATE "training_assessments"
SET "submitted_at" = "completed_at"
WHERE "status" = 'submitted'
  AND "submitted_at" IS NULL;--> statement-breakpoint
INSERT INTO "training_records" (
  "tenant_id",
  "person_id",
  "course_id",
  "source",
  "completed_on",
  "expires_on",
  "instructor",
  "certificate_type",
  "details"
)
SELECT
  assessment."tenant_id",
  assessment."person_id",
  assessment."course_id",
  'self_paced',
  COALESCE(assessment."completed_at", assessment."submitted_at", assessment."started_at")::date,
  CASE
    WHEN course."valid_for_months" IS NULL THEN NULL
    ELSE (
      COALESCE(assessment."completed_at", assessment."submitted_at", assessment."started_at")::date
      + make_interval(months => course."valid_for_months")
    )::date
  END,
  'Assessment completion',
  'auto',
  'Auto-recorded from assessment attempt ' || assessment."id"::text
FROM "training_assessments" AS assessment
INNER JOIN "training_courses" AS course
  ON course."tenant_id" = assessment."tenant_id"
  AND course."id" = assessment."course_id"
WHERE assessment."status" = 'submitted'
  AND assessment."graded" = false
  AND assessment."course_id" IS NOT NULL
  AND assessment."training_record_id" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "training_records" AS existing_record
    WHERE existing_record."tenant_id" = assessment."tenant_id"
      AND existing_record."details" = 'Auto-recorded from assessment attempt ' || assessment."id"::text
  );--> statement-breakpoint
UPDATE "training_assessments" AS assessment
SET "training_record_id" = record."id"
FROM "training_records" AS record
WHERE assessment."status" = 'submitted'
  AND assessment."graded" = false
  AND assessment."training_record_id" IS NULL
  AND record."tenant_id" = assessment."tenant_id"
  AND record."details" = 'Auto-recorded from assessment attempt ' || assessment."id"::text;--> statement-breakpoint
UPDATE "training_assessment_results" AS result
SET "correct" = NULL,
    "points_awarded" = 0
FROM "training_assessments" AS assessment
WHERE assessment."tenant_id" = result."tenant_id"
  AND assessment."id" = result."assessment_id"
  AND assessment."status" = 'submitted'
  AND assessment."graded" = false;--> statement-breakpoint
UPDATE "training_assessments"
SET "score" = NULL,
    "points_awarded" = NULL,
    "points_possible" = NULL,
    "passed" = true
WHERE "status" = 'submitted'
  AND "graded" = false;--> statement-breakpoint
UPDATE "training_assessments" AS assessment
SET "points_possible" = totals."points_possible"
FROM (
  SELECT "tenant_id", "assessment_id", COALESCE(SUM("points_possible"), 0)::integer AS "points_possible"
  FROM "training_assessment_results"
  GROUP BY "tenant_id", "assessment_id"
) AS totals
WHERE assessment."tenant_id" = totals."tenant_id"
  AND assessment."id" = totals."assessment_id"
  AND assessment."status" = 'in_progress'
  AND assessment."graded" = true;
