-- Hazard-assessment Builder apps use the assessment's canonical Location.
-- Remove the three built-in duplicate site-only fields and synchronize every
-- linked response so historical records participate in the same visibility,
-- reporting, and filtering rules as their parent assessment.
ALTER TABLE "form_template_versions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_responses" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

UPDATE "form_template_versions" AS version
SET "schema" = jsonb_set(
      version."schema",
      '{sections}',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_set(
              section_value,
              '{fields}',
              COALESCE(
                (
                  SELECT jsonb_agg(field_value ORDER BY field_index)
                  FROM jsonb_array_elements(COALESCE(section_value->'fields', '[]'::jsonb))
                    WITH ORDINALITY AS fields(field_value, field_index)
                  WHERE NOT (
                    field_value->>'id' = 'site'
                    AND field_value->>'type' = 'site_picker'
                  )
                ),
                '[]'::jsonb
              ),
              true
            )
            ORDER BY section_index
          )
          FROM jsonb_array_elements(COALESCE(version."schema"->'sections', '[]'::jsonb))
            WITH ORDINALITY AS sections(section_value, section_index)
        ),
        '[]'::jsonb
      ),
      true
    ),
    "updated_at" = now()
FROM "form_templates" AS template
WHERE template."tenant_id" = version."tenant_id"
  AND template."id" = version."template_id"
  AND template."key" IN (
    'hazid-confined-space-entry-plan',
    'hazid-arc-flash-work-plan',
    'hazid-fall-protection-plan'
  )
  AND jsonb_typeof(version."schema"->'sections') = 'array';--> statement-breakpoint

UPDATE "form_responses" AS response
SET "site_org_unit_id" = assessment."site_org_unit_id",
    "updated_at" = now()
FROM "hazid_assessment_app_responses" AS link
INNER JOIN "hazid_assessments" AS assessment
  ON assessment."tenant_id" = link."tenant_id"
 AND assessment."id" = link."assessment_id"
WHERE response."tenant_id" = link."tenant_id"
  AND response."id" = link."response_id"
  AND response."site_org_unit_id" IS DISTINCT FROM assessment."site_org_unit_id";--> statement-breakpoint

ALTER TABLE "form_responses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_template_versions" FORCE ROW LEVEL SECURITY;
