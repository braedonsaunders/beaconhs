-- Repair the incomplete assessment snapshots produced by the legacy importer
-- before enforcing the invariant for every future attempt. The question row is
-- the only reviewed canonical source available for the two native in-progress
-- attempts that were created before their imported choice definitions arrived.
ALTER TABLE "training_assessment_results" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "training_assessment_type_questions" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "training_assessments" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
UPDATE "training_assessment_results" AS result
SET
  "options_snapshot" = CASE
    WHEN result."kind_snapshot" IN ('single_choice', 'multi_choice')
      AND (
        result."options_snapshot" IS NULL
        OR jsonb_typeof(result."options_snapshot") <> 'array'
        OR jsonb_array_length(result."options_snapshot") < 2
      )
    THEN question."options"
    ELSE result."options_snapshot"
  END,
  "help_text_snapshot" = CASE
    WHEN assessment."notes" LIKE 'Migrated legacy quiz attempt.%'
    THEN question."help_text"
    ELSE result."help_text_snapshot"
  END,
  "mandatory_snapshot" = CASE
    WHEN assessment."notes" LIKE 'Migrated legacy quiz attempt.%'
    THEN question."mandatory"
    ELSE result."mandatory_snapshot"
  END
FROM "training_assessment_type_questions" AS question,
     "training_assessments" AS assessment
WHERE question."tenant_id" = result."tenant_id"
  AND question."id" = result."question_id"
  AND assessment."tenant_id" = result."tenant_id"
  AND assessment."id" = result."assessment_id"
  AND (
    assessment."notes" LIKE 'Migrated legacy quiz attempt.%'
    OR (
      result."kind_snapshot" IN ('single_choice', 'multi_choice')
      AND (
        result."options_snapshot" IS NULL
        OR jsonb_typeof(result."options_snapshot") <> 'array'
        OR jsonb_array_length(result."options_snapshot") < 2
      )
    )
  );
--> statement-breakpoint
DO $$
DECLARE
  invalid_templates integer;
  invalid_snapshots integer;
BEGIN
  SELECT count(*) INTO invalid_templates
  FROM "training_assessment_type_questions"
  WHERE "kind" IN ('single_choice', 'multi_choice')
    AND (
      "options" IS NULL
      OR jsonb_typeof("options") <> 'array'
      OR jsonb_array_length("options") NOT BETWEEN 2 AND 50
    );

  SELECT count(*) INTO invalid_snapshots
  FROM "training_assessment_results"
  WHERE "kind_snapshot" IN ('single_choice', 'multi_choice')
    AND (
      "options_snapshot" IS NULL
      OR jsonb_typeof("options_snapshot") <> 'array'
      OR jsonb_array_length("options_snapshot") NOT BETWEEN 2 AND 50
    );

  IF invalid_templates > 0 OR invalid_snapshots > 0 THEN
    RAISE EXCEPTION
      'assessment choice snapshot cutover blocked: % invalid template(s), % invalid snapshot(s)',
      invalid_templates,
      invalid_snapshots;
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "training_assessment_results" ADD CONSTRAINT "training_assessment_results_choice_options_snapshot_ck" CHECK (
        "training_assessment_results"."kind_snapshot" NOT IN ('single_choice', 'multi_choice')
        OR COALESCE(
          jsonb_typeof("training_assessment_results"."options_snapshot") = 'array'
          AND jsonb_array_length("training_assessment_results"."options_snapshot") BETWEEN 2 AND 50,
          false
        )
      ) NOT VALID;--> statement-breakpoint
ALTER TABLE "training_assessment_type_questions" ADD CONSTRAINT "training_assessment_type_questions_choice_options_ck" CHECK (
        "training_assessment_type_questions"."kind" NOT IN ('single_choice', 'multi_choice')
        OR COALESCE(
          jsonb_typeof("training_assessment_type_questions"."options") = 'array'
          AND jsonb_array_length("training_assessment_type_questions"."options") BETWEEN 2 AND 50,
          false
        )
      ) NOT VALID;--> statement-breakpoint
ALTER TABLE "training_assessment_results" VALIDATE CONSTRAINT "training_assessment_results_choice_options_snapshot_ck";--> statement-breakpoint
ALTER TABLE "training_assessment_type_questions" VALIDATE CONSTRAINT "training_assessment_type_questions_choice_options_ck";--> statement-breakpoint
ALTER TABLE "training_assessment_results" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "training_assessment_type_questions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "training_assessments" FORCE ROW LEVEL SECURITY;
