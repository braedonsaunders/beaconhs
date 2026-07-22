ALTER TABLE "training_assessment_results" ADD COLUMN "options_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "training_assessment_results" ADD COLUMN "mandatory_snapshot" boolean DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE "training_assessment_results" AS result
SET "options_snapshot" = question."options",
    "mandatory_snapshot" = question."mandatory"
FROM "training_assessment_type_questions" AS question
WHERE result."tenant_id" = question."tenant_id"
  AND result."question_id" = question."id";
