
-- Squashed source: packages/db/drizzle/0005_watery_blizzard.sql
-- content_html has been the canonical rich-text representation since the
-- training editor was introduced. Fail closed before removing the retired
-- ProseMirror JSON copy: any non-default legacy document must already have a
-- non-blank canonical HTML value. The dynamic query keeps this guard safe on a
-- second run after content_json has already been removed.
-- FORCE RLS would otherwise hide every tenant row from the NOLOGIN owner used
-- by the migrator. These catalog changes and the scan share one transaction;
-- RLS remains enabled for non-owners and FORCE is restored before either drop.
ALTER TABLE "training_content_items" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_lessons" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
DECLARE
  training_table text;
  unsafe_rows bigint;
BEGIN
  FOREACH training_table IN ARRAY ARRAY['training_content_items', 'training_lessons']
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = training_table
        AND column_name = 'content_json'
    ) THEN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = training_table
          AND column_name = 'content_html'
      ) THEN
        RAISE EXCEPTION
          'Cannot retire %.content_json: canonical content_html column is missing',
          training_table;
      END IF;

      EXECUTE format(
        $query$
          SELECT count(*)
          FROM %I.%I
          WHERE content_json IS NOT NULL
            AND content_json NOT IN (
              'null'::jsonb,
              '{}'::jsonb,
              '[]'::jsonb,
              '{"type":"doc","content":[]}'::jsonb,
              '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
              '{"type":"doc","content":[{"type":"paragraph","content":[]}]}'::jsonb
            )
            AND NULLIF(btrim(content_html), '') IS NULL
        $query$,
        current_schema(),
        training_table
      ) INTO unsafe_rows;

      IF unsafe_rows > 0 THEN
        RAISE EXCEPTION
          'Cannot retire %.content_json: % meaningful legacy row(s) have no canonical content_html',
          training_table,
          unsafe_rows;
      END IF;
    END IF;
  END LOOP;
END
$$;--> statement-breakpoint



ALTER TABLE "training_content_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_lessons" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_content_items" DROP COLUMN IF EXISTS "content_json";--> statement-breakpoint
ALTER TABLE "training_lessons" DROP COLUMN IF EXISTS "content_json";--> statement-breakpoint
-- Custom webhook headers and body templates were never exposed by the Flow
-- editor and had no encrypted secret-reference model. Remove any orphaned
-- plaintext values during the clean cutover; runtime-owned JSON headers and
-- payloads are the only supported webhook contract.
ALTER TABLE "form_automations" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "form_automations"
SET "graph" = jsonb_set(
  "graph",
  '{nodes}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN node #>> '{data,kind}' = 'action'
          AND node #>> '{data,action,action}' = 'webhook'
        THEN (node #- '{data,action,headers}') #- '{data,action,bodyTemplate}'
        ELSE node
      END
      ORDER BY ordinal
    )
    FROM jsonb_array_elements("form_automations"."graph" -> 'nodes')
      WITH ORDINALITY AS entries(node, ordinal)
  ),
  false
)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements("form_automations"."graph" -> 'nodes') AS entries(node)
  WHERE node #>> '{data,kind}' = 'action'
    AND node #>> '{data,action,action}' = 'webhook'
    AND (
      node #> '{data,action,headers}' IS NOT NULL
      OR node #> '{data,action,bodyTemplate}' IS NOT NULL
    )
);
--> statement-breakpoint
ALTER TABLE "form_automations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Squashed source: packages/db/drizzle/0006_lean_inhumans.sql
-- Builder forms use tenant-owned identifiers throughout. The legacy simple
-- foreign keys proved existence but could not prove tenant ownership or, for
-- responses, that the selected version/assignment belonged to the selected
-- template. FORCE RLS would hide all tenant rows from the NOLOGIN owner used by
-- the migrator, so transactionally relax FORCE on only the scanned tables,
-- validate all tenants, and restore FORCE before durable DDL.
ALTER TABLE "attachments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "flow_gates" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_assignments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_automations" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_response_checkins" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_response_comments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_response_participants" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_response_scores" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_response_steps" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_responses" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_template_versions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_templates" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_units" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Abort before any durable DDL if existing data violates those invariants.
DO $$
DECLARE
  violations text[];
BEGIN
  SELECT array_agg(format('%s=%s', relation_name, violation_count) ORDER BY relation_name)
  INTO violations
  FROM (
    SELECT 'form_template_versions.template' AS relation_name, count(*) AS violation_count
    FROM "form_template_versions" child
    LEFT JOIN "form_templates" parent ON parent."id" = child."template_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'form_assignments.template', count(*)
    FROM "form_assignments" child
    LEFT JOIN "form_templates" parent ON parent."id" = child."template_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'form_automations.template', count(*)
    FROM "form_automations" child
    LEFT JOIN "form_templates" parent ON parent."id" = child."template_id"
    WHERE child."template_id" IS NOT NULL
      AND (parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id")

    UNION ALL
    SELECT 'flow_gates.flow', count(*)
    FROM "flow_gates" child
    LEFT JOIN "form_automations" parent ON parent."id" = child."flow_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'form_responses.template', count(*)
    FROM "form_responses" child
    LEFT JOIN "form_templates" parent ON parent."id" = child."template_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'form_responses.version', count(*)
    FROM "form_responses" child
    LEFT JOIN "form_template_versions" parent ON parent."id" = child."template_version_id"
    WHERE parent."id" IS NULL
      OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"
      OR child."template_id" IS DISTINCT FROM parent."template_id"

    UNION ALL
    SELECT 'form_responses.assignment', count(*)
    FROM "form_responses" child
    LEFT JOIN "form_assignments" parent ON parent."id" = child."assignment_id"
    WHERE child."assignment_id" IS NOT NULL
      AND (
        parent."id" IS NULL
        OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"
        OR child."template_id" IS DISTINCT FROM parent."template_id"
      )

    UNION ALL
    SELECT 'form_responses.site_org_unit', count(*)
    FROM "form_responses" child
    LEFT JOIN "org_units" parent ON parent."id" = child."site_org_unit_id"
    WHERE child."site_org_unit_id" IS NOT NULL
      AND (parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id")

    UNION ALL
    SELECT 'form_responses.subject_person', count(*)
    FROM "form_responses" child
    LEFT JOIN "people" parent ON parent."id" = child."subject_person_id"
    WHERE child."subject_person_id" IS NOT NULL
      AND (parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id")

    UNION ALL
    SELECT 'form_response_checkins.response', count(*)
    FROM "form_response_checkins" child
    LEFT JOIN "form_responses" parent ON parent."id" = child."response_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'form_response_comments.response', count(*)
    FROM "form_response_comments" child
    LEFT JOIN "form_responses" parent ON parent."id" = child."response_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'form_response_scores.response', count(*)
    FROM "form_response_scores" child
    LEFT JOIN "form_responses" parent ON parent."id" = child."response_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'form_response_steps.response', count(*)
    FROM "form_response_steps" child
    LEFT JOIN "form_responses" parent ON parent."id" = child."response_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'form_response_steps.signed_by_person', count(*)
    FROM "form_response_steps" child
    LEFT JOIN "people" parent ON parent."id" = child."signed_by_person_id"
    WHERE child."signed_by_person_id" IS NOT NULL
      AND (parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id")

    UNION ALL
    SELECT 'form_response_participants.response', count(*)
    FROM "form_response_participants" child
    LEFT JOIN "form_responses" parent ON parent."id" = child."response_id"
    WHERE parent."id" IS NULL
      OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"
      OR child."template_id" IS DISTINCT FROM parent."template_id"

    UNION ALL
    SELECT 'form_response_participants.template', count(*)
    FROM "form_response_participants" child
    LEFT JOIN "form_templates" parent ON parent."id" = child."template_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'form_response_participants.person', count(*)
    FROM "form_response_participants" child
    LEFT JOIN "people" parent ON parent."id" = child."person_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'form_responses.pdf_attachment', count(*)
    FROM "form_responses" child
    LEFT JOIN "attachments" parent ON parent."id" = child."pdf_attachment_id"
    WHERE child."pdf_attachment_id" IS NOT NULL
      AND (parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id")

    UNION ALL
    SELECT 'form_response_steps.signature_attachment', count(*)
    FROM "form_response_steps" child
    LEFT JOIN "attachments" parent ON parent."id" = child."signature_attachment_id"
    WHERE child."signature_attachment_id" IS NOT NULL
      AND (parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id")

    UNION ALL
    SELECT 'flow_gates.signature_attachment', count(*)
    FROM "flow_gates" child
    LEFT JOIN "attachments" parent ON parent."id" = child."signature_attachment_id"
    WHERE child."signature_attachment_id" IS NOT NULL
      AND (parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id")
  ) checks
  WHERE violation_count > 0;

  IF coalesce(cardinality(violations), 0) > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'Builder form tenant/relation integrity preflight failed: %s',
        array_to_string(violations, ', ')
      );
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "flow_gates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_automations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_response_checkins" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_response_comments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_response_participants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_response_scores" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_response_steps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_responses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_template_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Referenced composite keys must exist before PostgreSQL can create the new
-- tenant-bound foreign keys.
CREATE UNIQUE INDEX "org_units_tenant_id_id_ux" ON "org_units" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_assignments_tenant_template_id_ux" ON "form_assignments" USING btree ("tenant_id","template_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_automations_tenant_id_id_ux" ON "form_automations" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_responses_tenant_id_id_ux" ON "form_responses" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_responses_tenant_template_id_ux" ON "form_responses" USING btree ("tenant_id","template_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_template_versions_tenant_template_id_ux" ON "form_template_versions" USING btree ("tenant_id","template_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_templates_tenant_id_id_ux" ON "form_templates" USING btree ("tenant_id","id");--> statement-breakpoint

-- Keep every composite child lookup indexed for parent updates/deletes and
-- normal tenant-scoped reads.
DROP INDEX "flow_gates_flow_idx";--> statement-breakpoint
DROP INDEX "form_assignments_template_idx";--> statement-breakpoint
DROP INDEX "form_automations_template_idx";--> statement-breakpoint
DROP INDEX "form_response_checkins_response_idx";--> statement-breakpoint
DROP INDEX "form_response_comments_response_idx";--> statement-breakpoint
DROP INDEX "form_response_scores_response_idx";--> statement-breakpoint
DROP INDEX "form_response_steps_response_idx";--> statement-breakpoint
DROP INDEX "form_response_participants_response_idx";--> statement-breakpoint
CREATE INDEX "flow_gates_flow_idx" ON "flow_gates" USING btree ("tenant_id","flow_id");--> statement-breakpoint
CREATE INDEX "form_assignments_template_idx" ON "form_assignments" USING btree ("tenant_id","template_id");--> statement-breakpoint
CREATE INDEX "form_automations_template_idx" ON "form_automations" USING btree ("tenant_id","template_id");--> statement-breakpoint
CREATE INDEX "form_response_checkins_response_idx" ON "form_response_checkins" USING btree ("tenant_id","response_id","recorded_at");--> statement-breakpoint
CREATE INDEX "form_response_comments_response_idx" ON "form_response_comments" USING btree ("tenant_id","response_id","created_at");--> statement-breakpoint
CREATE INDEX "form_response_scores_response_idx" ON "form_response_scores" USING btree ("tenant_id","response_id");--> statement-breakpoint
CREATE INDEX "form_response_steps_response_idx" ON "form_response_steps" USING btree ("tenant_id","response_id","sequence");--> statement-breakpoint
CREATE INDEX "form_response_participants_response_idx" ON "form_response_participants" USING btree ("tenant_id","template_id","response_id");--> statement-breakpoint
CREATE INDEX "form_response_steps_signed_by_person_idx" ON "form_response_steps" USING btree ("tenant_id","signed_by_person_id");--> statement-breakpoint
CREATE INDEX "form_responses_version_idx" ON "form_responses" USING btree ("tenant_id","template_id","template_version_id");--> statement-breakpoint
CREATE INDEX "form_responses_assignment_idx" ON "form_responses" USING btree ("tenant_id","template_id","assignment_id");--> statement-breakpoint
CREATE INDEX "form_responses_subject_person_idx" ON "form_responses" USING btree ("tenant_id","subject_person_id");--> statement-breakpoint

-- Install and validate the stronger keys while the legacy existence-only keys
-- are still present. Drop the weaker keys only after every new key validates.
ALTER TABLE "flow_gates" ADD CONSTRAINT "flow_gates_tenant_flow_fk" FOREIGN KEY ("tenant_id","flow_id") REFERENCES "public"."form_automations"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "flow_gates" VALIDATE CONSTRAINT "flow_gates_tenant_flow_fk";--> statement-breakpoint
ALTER TABLE "form_assignments" ADD CONSTRAINT "form_assignments_tenant_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."form_templates"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_assignments" VALIDATE CONSTRAINT "form_assignments_tenant_template_fk";--> statement-breakpoint
ALTER TABLE "form_automations" ADD CONSTRAINT "form_automations_tenant_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."form_templates"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_automations" VALIDATE CONSTRAINT "form_automations_tenant_template_fk";--> statement-breakpoint
ALTER TABLE "form_response_checkins" ADD CONSTRAINT "form_response_checkins_tenant_response_fk" FOREIGN KEY ("tenant_id","response_id") REFERENCES "public"."form_responses"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_response_checkins" VALIDATE CONSTRAINT "form_response_checkins_tenant_response_fk";--> statement-breakpoint
ALTER TABLE "form_response_comments" ADD CONSTRAINT "form_response_comments_tenant_response_fk" FOREIGN KEY ("tenant_id","response_id") REFERENCES "public"."form_responses"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_response_comments" VALIDATE CONSTRAINT "form_response_comments_tenant_response_fk";--> statement-breakpoint
ALTER TABLE "form_response_scores" ADD CONSTRAINT "form_response_scores_tenant_response_fk" FOREIGN KEY ("tenant_id","response_id") REFERENCES "public"."form_responses"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_response_scores" VALIDATE CONSTRAINT "form_response_scores_tenant_response_fk";--> statement-breakpoint
ALTER TABLE "form_response_steps" ADD CONSTRAINT "form_response_steps_tenant_response_fk" FOREIGN KEY ("tenant_id","response_id") REFERENCES "public"."form_responses"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_response_steps" VALIDATE CONSTRAINT "form_response_steps_tenant_response_fk";--> statement-breakpoint
ALTER TABLE "form_response_steps" ADD CONSTRAINT "form_response_steps_tenant_signed_by_person_fk" FOREIGN KEY ("tenant_id","signed_by_person_id") REFERENCES "public"."people"("tenant_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_response_steps" VALIDATE CONSTRAINT "form_response_steps_tenant_signed_by_person_fk";--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_tenant_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."form_templates"("tenant_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_responses" VALIDATE CONSTRAINT "form_responses_tenant_template_fk";--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_tenant_template_version_fk" FOREIGN KEY ("tenant_id","template_id","template_version_id") REFERENCES "public"."form_template_versions"("tenant_id","template_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_responses" VALIDATE CONSTRAINT "form_responses_tenant_template_version_fk";--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_tenant_template_assignment_fk" FOREIGN KEY ("tenant_id","template_id","assignment_id") REFERENCES "public"."form_assignments"("tenant_id","template_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_responses" VALIDATE CONSTRAINT "form_responses_tenant_template_assignment_fk";--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_tenant_site_org_unit_fk" FOREIGN KEY ("tenant_id","site_org_unit_id") REFERENCES "public"."org_units"("tenant_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_responses" VALIDATE CONSTRAINT "form_responses_tenant_site_org_unit_fk";--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_tenant_subject_person_fk" FOREIGN KEY ("tenant_id","subject_person_id") REFERENCES "public"."people"("tenant_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_responses" VALIDATE CONSTRAINT "form_responses_tenant_subject_person_fk";--> statement-breakpoint
ALTER TABLE "form_template_versions" ADD CONSTRAINT "form_template_versions_tenant_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."form_templates"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_template_versions" VALIDATE CONSTRAINT "form_template_versions_tenant_template_fk";--> statement-breakpoint
ALTER TABLE "form_response_participants" ADD CONSTRAINT "form_response_participants_tenant_template_response_fk" FOREIGN KEY ("tenant_id","template_id","response_id") REFERENCES "public"."form_responses"("tenant_id","template_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_response_participants" VALIDATE CONSTRAINT "form_response_participants_tenant_template_response_fk";--> statement-breakpoint
ALTER TABLE "form_response_participants" ADD CONSTRAINT "form_response_participants_tenant_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."form_templates"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_response_participants" VALIDATE CONSTRAINT "form_response_participants_tenant_template_fk";--> statement-breakpoint
ALTER TABLE "form_response_participants" ADD CONSTRAINT "form_response_participants_tenant_person_fk" FOREIGN KEY ("tenant_id","person_id") REFERENCES "public"."people"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "form_response_participants" VALIDATE CONSTRAINT "form_response_participants_tenant_person_fk";--> statement-breakpoint

ALTER TABLE "flow_gates" DROP CONSTRAINT "flow_gates_flow_id_form_automations_id_fk";--> statement-breakpoint
ALTER TABLE "form_assignments" DROP CONSTRAINT "form_assignments_template_id_form_templates_id_fk";--> statement-breakpoint
ALTER TABLE "form_automations" DROP CONSTRAINT "form_automations_template_id_form_templates_id_fk";--> statement-breakpoint
ALTER TABLE "form_response_checkins" DROP CONSTRAINT "form_response_checkins_response_id_form_responses_id_fk";--> statement-breakpoint
ALTER TABLE "form_response_comments" DROP CONSTRAINT "form_response_comments_response_id_form_responses_id_fk";--> statement-breakpoint
ALTER TABLE "form_response_scores" DROP CONSTRAINT "form_response_scores_response_id_form_responses_id_fk";--> statement-breakpoint
ALTER TABLE "form_response_steps" DROP CONSTRAINT "form_response_steps_response_id_form_responses_id_fk";--> statement-breakpoint
ALTER TABLE "form_response_steps" DROP CONSTRAINT "form_response_steps_signed_by_person_id_people_id_fk";--> statement-breakpoint
ALTER TABLE "form_responses" DROP CONSTRAINT "form_responses_template_id_form_templates_id_fk";--> statement-breakpoint
ALTER TABLE "form_responses" DROP CONSTRAINT "form_responses_template_version_id_form_template_versions_id_fk";--> statement-breakpoint
ALTER TABLE "form_responses" DROP CONSTRAINT "form_responses_assignment_id_form_assignments_id_fk";--> statement-breakpoint
ALTER TABLE "form_responses" DROP CONSTRAINT "form_responses_site_org_unit_id_org_units_id_fk";--> statement-breakpoint
ALTER TABLE "form_responses" DROP CONSTRAINT "form_responses_subject_person_id_people_id_fk";--> statement-breakpoint
ALTER TABLE "form_template_versions" DROP CONSTRAINT "form_template_versions_template_id_form_templates_id_fk";--> statement-breakpoint
ALTER TABLE "form_response_participants" DROP CONSTRAINT "form_response_participants_response_id_form_responses_id_fk";--> statement-breakpoint
ALTER TABLE "form_response_participants" DROP CONSTRAINT "form_response_participants_template_id_form_templates_id_fk";--> statement-breakpoint
ALTER TABLE "form_response_participants" DROP CONSTRAINT "form_response_participants_person_id_people_id_fk";
--> statement-breakpoint

-- Squashed source: packages/db/drizzle/0007_pink_marvex.sql
-- HazID embeds Builder responses through two denormalized links. Fail closed
-- if an existing link is orphaned, crosses tenants, or names a template that
-- does not own the linked response/type-app definition. Transactionally relax
-- FORCE RLS on only these scanned tables so the NOLOGIN owner sees all tenants,
-- then restore FORCE before durable DDL.
ALTER TABLE "form_responses" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_templates" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_app_responses" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_apps" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DO $$
DECLARE
  violations text[];
BEGIN
  SELECT array_agg(format('%s=%s', relation_name, violation_count) ORDER BY relation_name)
  INTO violations
  FROM (
    SELECT 'hazid_assessment_type_apps.template' AS relation_name, count(*) AS violation_count
    FROM "hazid_assessment_type_apps" child
    LEFT JOIN "form_templates" parent ON parent."id" = child."template_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'hazid_assessment_app_responses.template', count(*)
    FROM "hazid_assessment_app_responses" child
    LEFT JOIN "form_templates" parent ON parent."id" = child."template_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'hazid_assessment_app_responses.response', count(*)
    FROM "hazid_assessment_app_responses" child
    LEFT JOIN "form_responses" parent ON parent."id" = child."response_id"
    WHERE parent."id" IS NULL
      OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"
      OR child."template_id" IS DISTINCT FROM parent."template_id"

    UNION ALL
    SELECT 'hazid_assessment_app_responses.type_app', count(*)
    FROM "hazid_assessment_app_responses" child
    LEFT JOIN "hazid_assessment_type_apps" parent ON parent."id" = child."type_app_id"
    WHERE child."type_app_id" IS NOT NULL
      AND (
        parent."id" IS NULL
        OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"
        OR child."template_id" IS DISTINCT FROM parent."template_id"
      )
  ) checks
  WHERE violation_count > 0;

  IF coalesce(cardinality(violations), 0) > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'HazID Builder-link integrity preflight failed: %s',
        array_to_string(violations, ', ')
      );
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "form_responses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_app_responses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_apps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE UNIQUE INDEX "hazid_assessment_type_apps_tenant_template_id_ux" ON "hazid_assessment_type_apps" USING btree ("tenant_id","template_id","id");--> statement-breakpoint

DROP INDEX "hazid_assessment_type_apps_template_idx";--> statement-breakpoint
DROP INDEX "hazid_assessment_app_responses_response_idx";--> statement-breakpoint
CREATE INDEX "hazid_assessment_app_responses_type_app_idx" ON "hazid_assessment_app_responses" USING btree ("tenant_id","template_id","type_app_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_type_apps_template_idx" ON "hazid_assessment_type_apps" USING btree ("tenant_id","template_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_app_responses_response_idx" ON "hazid_assessment_app_responses" USING btree ("tenant_id","template_id","response_id");--> statement-breakpoint

-- Add and validate every stronger key before removing the old existence-only
-- key. The type-app relationship uses PostgreSQL's column-list SET NULL so a
-- deleted definition clears only type_app_id and preserves the historical
-- tenant/template/response link; Drizzle cannot express this action.
ALTER TABLE "hazid_assessment_type_apps" ADD CONSTRAINT "hazid_assessment_type_apps_tenant_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."form_templates"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_apps" VALIDATE CONSTRAINT "hazid_assessment_type_apps_tenant_template_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_app_responses" ADD CONSTRAINT "hazid_assessment_app_responses_tenant_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."form_templates"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessment_app_responses" VALIDATE CONSTRAINT "hazid_assessment_app_responses_tenant_template_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_app_responses" ADD CONSTRAINT "hazid_assessment_app_responses_tenant_template_response_fk" FOREIGN KEY ("tenant_id","template_id","response_id") REFERENCES "public"."form_responses"("tenant_id","template_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessment_app_responses" VALIDATE CONSTRAINT "hazid_assessment_app_responses_tenant_template_response_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_app_responses" ADD CONSTRAINT "hazid_assessment_app_responses_tenant_template_type_app_fk" FOREIGN KEY ("tenant_id","template_id","type_app_id") REFERENCES "public"."hazid_assessment_type_apps"("tenant_id","template_id","id") ON DELETE SET NULL ("type_app_id") ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessment_app_responses" VALIDATE CONSTRAINT "hazid_assessment_app_responses_tenant_template_type_app_fk";--> statement-breakpoint

ALTER TABLE "hazid_assessment_type_apps" DROP CONSTRAINT "hazid_assessment_type_apps_template_id_form_templates_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_app_responses" DROP CONSTRAINT "hazid_assessment_app_responses_type_app_id_hazid_assessment_type_apps_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_app_responses" DROP CONSTRAINT "hazid_assessment_app_responses_template_id_form_templates_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_app_responses" DROP CONSTRAINT "hazid_assessment_app_responses_response_id_form_responses_id_fk";
--> statement-breakpoint

-- Squashed source: packages/db/drizzle/0008_fast_warbound.sql
-- HazID is tenant-owned end to end. The legacy foreign keys proved that an ID
-- existed but did not prove that the related row belonged to the same tenant.
-- The migration role SET ROLEs to the NOLOGIN owner, while tenant tables use
-- FORCE RLS. Transactionally relax FORCE (RLS stays enabled for non-owners),
-- scan as the owner, and restore FORCE before any durable DDL. Drizzle executes
-- the whole migration in one transaction, so an error also rolls these catalog
-- changes back and no other session can observe the intermediate state.
ALTER TABLE "tenant_users" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_units" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_hazard_types" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_hazards" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_hazard_sets" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_tasks" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_location_tasks" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_types" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_ppe" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_questions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_apps" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_tasks" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_hazards" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_signatures" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_ppe" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_questions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_photos" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_app_responses" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Abort before any durable DDL if existing rows violate the stronger
-- invariants.
DO $$
DECLARE
  violations text[];
BEGIN
  SELECT array_agg(format('%s=%s', relation_name, violation_count) ORDER BY relation_name)
  INTO violations
  FROM (
    SELECT 'hazid_assessment_type_apps.type' AS relation_name, count(*) AS violation_count
    FROM "hazid_assessment_type_apps" child
    LEFT JOIN "hazid_assessment_types" parent ON parent."id" = child."type_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'hazid_assessment_type_ppe.type', count(*)
    FROM "hazid_assessment_type_ppe" child
    LEFT JOIN "hazid_assessment_types" parent ON parent."id" = child."type_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'hazid_assessment_type_questions.type', count(*)
    FROM "hazid_assessment_type_questions" child
    LEFT JOIN "hazid_assessment_types" parent ON parent."id" = child."type_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'hazid_assessment_types.default_hazard_set', count(*)
    FROM "hazid_assessment_types" child
    LEFT JOIN "hazid_hazard_sets" parent ON parent."id" = child."default_hazard_set_id"
    WHERE child."default_hazard_set_id" IS NOT NULL
      AND (parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id")

    UNION ALL
    SELECT 'hazid_hazards.hazard_type', count(*)
    FROM "hazid_hazards" child
    LEFT JOIN "hazid_hazard_types" parent ON parent."id" = child."hazard_type_id"
    WHERE child."hazard_type_id" IS NOT NULL
      AND (parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id")

    UNION ALL
    SELECT 'hazid_location_tasks.org_unit', count(*)
    FROM "hazid_location_tasks" child
    LEFT JOIN "org_units" parent ON parent."id" = child."org_unit_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'hazid_location_tasks.task', count(*)
    FROM "hazid_location_tasks" child
    LEFT JOIN "hazid_tasks" parent ON parent."id" = child."task_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'hazid_assessment_app_responses.assessment', count(*)
    FROM "hazid_assessment_app_responses" child
    LEFT JOIN "hazid_assessments" parent ON parent."id" = child."assessment_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'hazid_assessment_hazards.assessment', count(*)
    FROM "hazid_assessment_hazards" child
    LEFT JOIN "hazid_assessments" parent ON parent."id" = child."assessment_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'hazid_assessment_hazards.hazard', count(*)
    FROM "hazid_assessment_hazards" child
    LEFT JOIN "hazid_hazards" parent ON parent."id" = child."hazard_id"
    WHERE child."hazard_id" IS NOT NULL
      AND (parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id")

    UNION ALL
    SELECT 'hazid_assessment_ppe.assessment', count(*)
    FROM "hazid_assessment_ppe" child
    LEFT JOIN "hazid_assessments" parent ON parent."id" = child."assessment_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'hazid_assessment_photos.assessment', count(*)
    FROM "hazid_assessment_photos" child
    LEFT JOIN "hazid_assessments" parent ON parent."id" = child."assessment_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'hazid_assessment_questions.assessment', count(*)
    FROM "hazid_assessment_questions" child
    LEFT JOIN "hazid_assessments" parent ON parent."id" = child."assessment_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'hazid_assessment_signatures.assessment', count(*)
    FROM "hazid_assessment_signatures" child
    LEFT JOIN "hazid_assessments" parent ON parent."id" = child."assessment_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'hazid_assessment_signatures.person', count(*)
    FROM "hazid_assessment_signatures" child
    LEFT JOIN "people" parent ON parent."id" = child."person_id"
    WHERE child."person_id" IS NOT NULL
      AND (parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id")

    UNION ALL
    SELECT 'hazid_assessment_tasks.assessment', count(*)
    FROM "hazid_assessment_tasks" child
    LEFT JOIN "hazid_assessments" parent ON parent."id" = child."assessment_id"
    WHERE parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id"

    UNION ALL
    SELECT 'hazid_assessment_tasks.task', count(*)
    FROM "hazid_assessment_tasks" child
    LEFT JOIN "hazid_tasks" parent ON parent."id" = child."task_id"
    WHERE child."task_id" IS NOT NULL
      AND (parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id")

    UNION ALL
    SELECT 'hazid_assessments.site_org_unit', count(*)
    FROM "hazid_assessments" child
    LEFT JOIN "org_units" parent ON parent."id" = child."site_org_unit_id"
    WHERE child."site_org_unit_id" IS NOT NULL
      AND (parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id")

    UNION ALL
    SELECT 'hazid_assessments.project_org_unit', count(*)
    FROM "hazid_assessments" child
    LEFT JOIN "org_units" parent ON parent."id" = child."project_org_unit_id"
    WHERE child."project_org_unit_id" IS NOT NULL
      AND (parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id")

    UNION ALL
    SELECT 'hazid_assessments.supervisor_tenant_user', count(*)
    FROM "hazid_assessments" child
    LEFT JOIN "tenant_users" parent ON parent."id" = child."supervisor_tenant_user_id"
    WHERE child."supervisor_tenant_user_id" IS NOT NULL
      AND (parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id")

    UNION ALL
    SELECT 'hazid_assessments.supervisor_person', count(*)
    FROM "hazid_assessments" child
    LEFT JOIN "people" parent ON parent."id" = child."supervisor_person_id"
    WHERE child."supervisor_person_id" IS NOT NULL
      AND (parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id")

    UNION ALL
    SELECT 'hazid_assessments.reported_by_tenant_user', count(*)
    FROM "hazid_assessments" child
    LEFT JOIN "tenant_users" parent ON parent."id" = child."reported_by_tenant_user_id"
    WHERE child."reported_by_tenant_user_id" IS NOT NULL
      AND (parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id")

    UNION ALL
    SELECT 'hazid_assessments.assessment_type', count(*)
    FROM "hazid_assessments" child
    LEFT JOIN "hazid_assessment_types" parent ON parent."id" = child."assessment_type_id"
    WHERE child."assessment_type_id" IS NOT NULL
      AND (parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id")

    UNION ALL
    SELECT 'hazid_assessments.locked_by_tenant_user', count(*)
    FROM "hazid_assessments" child
    LEFT JOIN "tenant_users" parent ON parent."id" = child."locked_by_tenant_user_id"
    WHERE child."locked_by_tenant_user_id" IS NOT NULL
      AND (parent."id" IS NULL OR child."tenant_id" IS DISTINCT FROM parent."tenant_id")
  ) checks
  WHERE violation_count > 0;

  IF coalesce(cardinality(violations), 0) > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'HazID tenant/relation integrity preflight failed: %s',
        array_to_string(violations, ', ')
      );
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "tenant_users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_hazard_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_hazards" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_hazard_sets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_tasks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_location_tasks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_ppe" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_questions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_apps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_tasks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_hazards" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_signatures" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_ppe" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_questions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_photos" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_app_responses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Referenced composite keys must exist before PostgreSQL can install the new
-- tenant-bound foreign keys.
CREATE UNIQUE INDEX "hazid_assessment_types_tenant_id_id_ux" ON "hazid_assessment_types" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "hazid_hazard_sets_tenant_id_id_ux" ON "hazid_hazard_sets" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "hazid_hazard_types_tenant_id_id_ux" ON "hazid_hazard_types" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "hazid_hazards_tenant_id_id_ux" ON "hazid_hazards" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "hazid_tasks_tenant_id_id_ux" ON "hazid_tasks" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "hazid_assessments_tenant_id_id_ux" ON "hazid_assessments" USING btree ("tenant_id","id");--> statement-breakpoint

-- Keep every composite child lookup indexed for parent updates/deletes and
-- normal tenant-scoped reads.
DROP INDEX "hazid_assessment_type_apps_type_idx";--> statement-breakpoint
DROP INDEX "hazid_assessment_type_ppe_type_idx";--> statement-breakpoint
DROP INDEX "hazid_assessment_type_questions_type_idx";--> statement-breakpoint
DROP INDEX "hazid_location_tasks_org_idx";--> statement-breakpoint
DROP INDEX "hazid_location_tasks_task_idx";--> statement-breakpoint
DROP INDEX "hazid_location_tasks_org_task_ux";--> statement-breakpoint
DROP INDEX "hazid_assessment_app_responses_assessment_idx";--> statement-breakpoint
DROP INDEX "hazid_assessment_hazards_assessment_idx";--> statement-breakpoint
DROP INDEX "hazid_assessment_ppe_assessment_idx";--> statement-breakpoint
DROP INDEX "hazid_assessment_photos_assessment_idx";--> statement-breakpoint
DROP INDEX "hazid_assessment_questions_assessment_idx";--> statement-breakpoint
DROP INDEX "hazid_assessment_signatures_assessment_idx";--> statement-breakpoint
DROP INDEX "hazid_assessment_tasks_assessment_idx";--> statement-breakpoint
CREATE INDEX "hazid_assessment_types_default_hazard_set_idx" ON "hazid_assessment_types" USING btree ("tenant_id","default_hazard_set_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_type_apps_type_idx" ON "hazid_assessment_type_apps" USING btree ("tenant_id","type_id","entity_order");--> statement-breakpoint
CREATE INDEX "hazid_assessment_type_ppe_type_idx" ON "hazid_assessment_type_ppe" USING btree ("tenant_id","type_id","entity_order");--> statement-breakpoint
CREATE INDEX "hazid_assessment_type_questions_type_idx" ON "hazid_assessment_type_questions" USING btree ("tenant_id","type_id","entity_order");--> statement-breakpoint
CREATE INDEX "hazid_location_tasks_org_idx" ON "hazid_location_tasks" USING btree ("tenant_id","org_unit_id");--> statement-breakpoint
CREATE INDEX "hazid_location_tasks_task_idx" ON "hazid_location_tasks" USING btree ("tenant_id","task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hazid_location_tasks_org_task_ux" ON "hazid_location_tasks" USING btree ("tenant_id","org_unit_id","task_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_app_responses_assessment_idx" ON "hazid_assessment_app_responses" USING btree ("tenant_id","assessment_id","entity_order");--> statement-breakpoint
CREATE INDEX "hazid_assessment_hazards_assessment_idx" ON "hazid_assessment_hazards" USING btree ("tenant_id","assessment_id","entity_order");--> statement-breakpoint
CREATE INDEX "hazid_assessment_hazards_hazard_idx" ON "hazid_assessment_hazards" USING btree ("tenant_id","hazard_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_ppe_assessment_idx" ON "hazid_assessment_ppe" USING btree ("tenant_id","assessment_id","entity_order");--> statement-breakpoint
CREATE INDEX "hazid_assessment_photos_assessment_idx" ON "hazid_assessment_photos" USING btree ("tenant_id","assessment_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_questions_assessment_idx" ON "hazid_assessment_questions" USING btree ("tenant_id","assessment_id","entity_order");--> statement-breakpoint
CREATE INDEX "hazid_assessment_signatures_assessment_idx" ON "hazid_assessment_signatures" USING btree ("tenant_id","assessment_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_signatures_person_idx" ON "hazid_assessment_signatures" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "hazid_assessment_tasks_assessment_idx" ON "hazid_assessment_tasks" USING btree ("tenant_id","assessment_id","entity_order");--> statement-breakpoint
CREATE INDEX "hazid_assessment_tasks_task_idx" ON "hazid_assessment_tasks" USING btree ("tenant_id","task_id");--> statement-breakpoint
CREATE INDEX "hazid_assessments_project_idx" ON "hazid_assessments" USING btree ("tenant_id","project_org_unit_id");--> statement-breakpoint
CREATE INDEX "hazid_assessments_supervisor_user_idx" ON "hazid_assessments" USING btree ("tenant_id","supervisor_tenant_user_id");--> statement-breakpoint
CREATE INDEX "hazid_assessments_reported_by_idx" ON "hazid_assessments" USING btree ("tenant_id","reported_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "hazid_assessments_locked_by_idx" ON "hazid_assessments" USING btree ("tenant_id","locked_by_tenant_user_id");--> statement-breakpoint

-- Install and validate the stronger keys while the legacy existence-only keys
-- still protect their original relationships.
ALTER TABLE "hazid_assessment_type_apps" ADD CONSTRAINT "hazid_assessment_type_apps_tenant_type_fk" FOREIGN KEY ("tenant_id","type_id") REFERENCES "public"."hazid_assessment_types"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_apps" VALIDATE CONSTRAINT "hazid_assessment_type_apps_tenant_type_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_ppe" ADD CONSTRAINT "hazid_assessment_type_ppe_tenant_type_fk" FOREIGN KEY ("tenant_id","type_id") REFERENCES "public"."hazid_assessment_types"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_ppe" VALIDATE CONSTRAINT "hazid_assessment_type_ppe_tenant_type_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_questions" ADD CONSTRAINT "hazid_assessment_type_questions_tenant_type_fk" FOREIGN KEY ("tenant_id","type_id") REFERENCES "public"."hazid_assessment_types"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_questions" VALIDATE CONSTRAINT "hazid_assessment_type_questions_tenant_type_fk";--> statement-breakpoint
ALTER TABLE "hazid_location_tasks" ADD CONSTRAINT "hazid_location_tasks_tenant_org_unit_fk" FOREIGN KEY ("tenant_id","org_unit_id") REFERENCES "public"."org_units"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_location_tasks" VALIDATE CONSTRAINT "hazid_location_tasks_tenant_org_unit_fk";--> statement-breakpoint
ALTER TABLE "hazid_location_tasks" ADD CONSTRAINT "hazid_location_tasks_tenant_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."hazid_tasks"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_location_tasks" VALIDATE CONSTRAINT "hazid_location_tasks_tenant_task_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_app_responses" ADD CONSTRAINT "hazid_assessment_app_responses_tenant_assessment_fk" FOREIGN KEY ("tenant_id","assessment_id") REFERENCES "public"."hazid_assessments"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessment_app_responses" VALIDATE CONSTRAINT "hazid_assessment_app_responses_tenant_assessment_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_hazards" ADD CONSTRAINT "hazid_assessment_hazards_tenant_assessment_fk" FOREIGN KEY ("tenant_id","assessment_id") REFERENCES "public"."hazid_assessments"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessment_hazards" VALIDATE CONSTRAINT "hazid_assessment_hazards_tenant_assessment_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_ppe" ADD CONSTRAINT "hazid_assessment_ppe_tenant_assessment_fk" FOREIGN KEY ("tenant_id","assessment_id") REFERENCES "public"."hazid_assessments"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessment_ppe" VALIDATE CONSTRAINT "hazid_assessment_ppe_tenant_assessment_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_photos" ADD CONSTRAINT "hazid_assessment_photos_tenant_assessment_fk" FOREIGN KEY ("tenant_id","assessment_id") REFERENCES "public"."hazid_assessments"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessment_photos" VALIDATE CONSTRAINT "hazid_assessment_photos_tenant_assessment_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_questions" ADD CONSTRAINT "hazid_assessment_questions_tenant_assessment_fk" FOREIGN KEY ("tenant_id","assessment_id") REFERENCES "public"."hazid_assessments"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessment_questions" VALIDATE CONSTRAINT "hazid_assessment_questions_tenant_assessment_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_signatures" ADD CONSTRAINT "hazid_assessment_signatures_tenant_assessment_fk" FOREIGN KEY ("tenant_id","assessment_id") REFERENCES "public"."hazid_assessments"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessment_signatures" VALIDATE CONSTRAINT "hazid_assessment_signatures_tenant_assessment_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_tasks" ADD CONSTRAINT "hazid_assessment_tasks_tenant_assessment_fk" FOREIGN KEY ("tenant_id","assessment_id") REFERENCES "public"."hazid_assessments"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessment_tasks" VALIDATE CONSTRAINT "hazid_assessment_tasks_tenant_assessment_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessments" ADD CONSTRAINT "hazid_assessments_tenant_locked_by_user_fk" FOREIGN KEY ("tenant_id","locked_by_tenant_user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessments" VALIDATE CONSTRAINT "hazid_assessments_tenant_locked_by_user_fk";--> statement-breakpoint

-- These nullable relationships intentionally clear only the nullable business
-- ID. Clearing tenant_id would corrupt ownership and violate its NOT NULL key;
-- Drizzle cannot express PostgreSQL's column-list SET NULL action.
ALTER TABLE "hazid_assessment_types" ADD CONSTRAINT "hazid_assessment_types_tenant_default_hazard_set_fk" FOREIGN KEY ("tenant_id","default_hazard_set_id") REFERENCES "public"."hazid_hazard_sets"("tenant_id","id") ON DELETE SET NULL ("default_hazard_set_id") ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessment_types" VALIDATE CONSTRAINT "hazid_assessment_types_tenant_default_hazard_set_fk";--> statement-breakpoint
ALTER TABLE "hazid_hazards" ADD CONSTRAINT "hazid_hazards_tenant_hazard_type_fk" FOREIGN KEY ("tenant_id","hazard_type_id") REFERENCES "public"."hazid_hazard_types"("tenant_id","id") ON DELETE SET NULL ("hazard_type_id") ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_hazards" VALIDATE CONSTRAINT "hazid_hazards_tenant_hazard_type_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_hazards" ADD CONSTRAINT "hazid_assessment_hazards_tenant_hazard_fk" FOREIGN KEY ("tenant_id","hazard_id") REFERENCES "public"."hazid_hazards"("tenant_id","id") ON DELETE SET NULL ("hazard_id") ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessment_hazards" VALIDATE CONSTRAINT "hazid_assessment_hazards_tenant_hazard_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_signatures" ADD CONSTRAINT "hazid_assessment_signatures_tenant_person_fk" FOREIGN KEY ("tenant_id","person_id") REFERENCES "public"."people"("tenant_id","id") ON DELETE SET NULL ("person_id") ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessment_signatures" VALIDATE CONSTRAINT "hazid_assessment_signatures_tenant_person_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_tasks" ADD CONSTRAINT "hazid_assessment_tasks_tenant_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."hazid_tasks"("tenant_id","id") ON DELETE SET NULL ("task_id") ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessment_tasks" VALIDATE CONSTRAINT "hazid_assessment_tasks_tenant_task_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessments" ADD CONSTRAINT "hazid_assessments_tenant_site_org_unit_fk" FOREIGN KEY ("tenant_id","site_org_unit_id") REFERENCES "public"."org_units"("tenant_id","id") ON DELETE SET NULL ("site_org_unit_id") ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessments" VALIDATE CONSTRAINT "hazid_assessments_tenant_site_org_unit_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessments" ADD CONSTRAINT "hazid_assessments_tenant_project_org_unit_fk" FOREIGN KEY ("tenant_id","project_org_unit_id") REFERENCES "public"."org_units"("tenant_id","id") ON DELETE SET NULL ("project_org_unit_id") ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessments" VALIDATE CONSTRAINT "hazid_assessments_tenant_project_org_unit_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessments" ADD CONSTRAINT "hazid_assessments_tenant_supervisor_user_fk" FOREIGN KEY ("tenant_id","supervisor_tenant_user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE SET NULL ("supervisor_tenant_user_id") ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessments" VALIDATE CONSTRAINT "hazid_assessments_tenant_supervisor_user_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessments" ADD CONSTRAINT "hazid_assessments_tenant_supervisor_person_fk" FOREIGN KEY ("tenant_id","supervisor_person_id") REFERENCES "public"."people"("tenant_id","id") ON DELETE SET NULL ("supervisor_person_id") ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessments" VALIDATE CONSTRAINT "hazid_assessments_tenant_supervisor_person_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessments" ADD CONSTRAINT "hazid_assessments_tenant_reported_by_user_fk" FOREIGN KEY ("tenant_id","reported_by_tenant_user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE SET NULL ("reported_by_tenant_user_id") ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessments" VALIDATE CONSTRAINT "hazid_assessments_tenant_reported_by_user_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessments" ADD CONSTRAINT "hazid_assessments_tenant_assessment_type_fk" FOREIGN KEY ("tenant_id","assessment_type_id") REFERENCES "public"."hazid_assessment_types"("tenant_id","id") ON DELETE SET NULL ("assessment_type_id") ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "hazid_assessments" VALIDATE CONSTRAINT "hazid_assessments_tenant_assessment_type_fk";--> statement-breakpoint

-- Remove the weaker keys only after every stronger key has validated.
ALTER TABLE "hazid_assessment_type_apps" DROP CONSTRAINT "hazid_assessment_type_apps_type_id_hazid_assessment_types_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_ppe" DROP CONSTRAINT "hazid_assessment_type_ppe_type_id_hazid_assessment_types_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_type_questions" DROP CONSTRAINT "hazid_assessment_type_questions_type_id_hazid_assessment_types_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_types" DROP CONSTRAINT "hazid_assessment_types_default_hazard_set_id_hazid_hazard_sets_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_hazards" DROP CONSTRAINT "hazid_hazards_hazard_type_id_hazid_hazard_types_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_location_tasks" DROP CONSTRAINT "hazid_location_tasks_org_unit_id_org_units_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_location_tasks" DROP CONSTRAINT "hazid_location_tasks_task_id_hazid_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_app_responses" DROP CONSTRAINT "hazid_assessment_app_responses_assessment_id_hazid_assessments_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_hazards" DROP CONSTRAINT "hazid_assessment_hazards_assessment_id_hazid_assessments_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_hazards" DROP CONSTRAINT "hazid_assessment_hazards_hazard_id_hazid_hazards_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_ppe" DROP CONSTRAINT "hazid_assessment_ppe_assessment_id_hazid_assessments_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_photos" DROP CONSTRAINT "hazid_assessment_photos_assessment_id_hazid_assessments_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_questions" DROP CONSTRAINT "hazid_assessment_questions_assessment_id_hazid_assessments_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_signatures" DROP CONSTRAINT "hazid_assessment_signatures_assessment_id_hazid_assessments_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_signatures" DROP CONSTRAINT "hazid_assessment_signatures_person_id_people_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_tasks" DROP CONSTRAINT "hazid_assessment_tasks_assessment_id_hazid_assessments_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessment_tasks" DROP CONSTRAINT "hazid_assessment_tasks_task_id_hazid_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessments" DROP CONSTRAINT "hazid_assessments_site_org_unit_id_org_units_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessments" DROP CONSTRAINT "hazid_assessments_project_org_unit_id_org_units_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessments" DROP CONSTRAINT "hazid_assessments_supervisor_tenant_user_id_tenant_users_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessments" DROP CONSTRAINT "hazid_assessments_supervisor_person_id_people_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessments" DROP CONSTRAINT "hazid_assessments_reported_by_tenant_user_id_tenant_users_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessments" DROP CONSTRAINT "hazid_assessments_assessment_type_id_hazid_assessment_types_id_fk";--> statement-breakpoint
ALTER TABLE "hazid_assessments" DROP CONSTRAINT "hazid_assessments_locked_by_tenant_user_id_tenant_users_id_fk";
--> statement-breakpoint

-- Squashed source: packages/db/drizzle/0009_special_redwing.sql
-- Equipment, inspection, maintenance, checkout, and truck-log records are
-- tenant-owned end to end. The legacy foreign keys proved only that an ID
-- existed. This manifest is the single source used to preflight, install,
-- validate, and retire all 55 relationships while preserving their original
-- delete behavior.
CREATE TEMP TABLE "equipment_relationship_hardening" (
  "ordinal" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "relation_name" text NOT NULL,
  "child_table" text NOT NULL,
  "child_column" text NOT NULL,
  "parent_table" text NOT NULL,
  "constraint_name" text NOT NULL,
  "legacy_constraint" text NOT NULL,
  "delete_action" text NOT NULL CHECK ("delete_action" IN ('cascade', 'no action', 'set null'))
) ON COMMIT DROP;--> statement-breakpoint

INSERT INTO "equipment_relationship_hardening" (
  "relation_name",
  "child_table",
  "child_column",
  "parent_table",
  "constraint_name",
  "legacy_constraint",
  "delete_action"
) VALUES
  ('equipment_checkouts.checked_in_by_tenant_user', 'equipment_checkouts', 'checked_in_by_tenant_user_id', 'tenant_users', 'equipment_checkouts_tenant_checked_in_by_fk', 'equipment_checkouts_checked_in_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('equipment_checkouts.checked_out_by_tenant_user', 'equipment_checkouts', 'checked_out_by_tenant_user_id', 'tenant_users', 'equipment_checkouts_tenant_checked_out_by_fk', 'equipment_checkouts_checked_out_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('equipment_checkouts.destination_org_unit', 'equipment_checkouts', 'destination_org_unit_id', 'org_units', 'equipment_checkouts_tenant_destination_fk', 'equipment_checkouts_destination_org_unit_id_org_units_id_fk', 'no action'),
  ('equipment_checkouts.equipment_item', 'equipment_checkouts', 'equipment_item_id', 'equipment_items', 'equipment_checkouts_tenant_item_fk', 'equipment_checkouts_equipment_item_id_equipment_items_id_fk', 'cascade'),
  ('equipment_checkouts.holder_person', 'equipment_checkouts', 'holder_person_id', 'people', 'equipment_checkouts_tenant_holder_fk', 'equipment_checkouts_holder_person_id_people_id_fk', 'no action'),
  ('equipment_inspection_criteria.group', 'equipment_inspection_criteria', 'group_id', 'equipment_inspection_groups', 'equipment_inspection_criteria_tenant_group_fk', 'equipment_inspection_criteria_group_id_equipment_inspection_groups_id_fk', 'set null'),
  ('equipment_inspection_criteria.inspection_type', 'equipment_inspection_criteria', 'inspection_type_id', 'equipment_inspection_types', 'equipment_inspection_criteria_tenant_type_fk', 'equipment_inspection_criteria_inspection_type_id_equipment_inspection_types_id_fk', 'cascade'),
  ('equipment_inspection_groups.inspection_type', 'equipment_inspection_groups', 'inspection_type_id', 'equipment_inspection_types', 'equipment_inspection_groups_tenant_type_fk', 'equipment_inspection_groups_inspection_type_id_equipment_inspection_types_id_fk', 'cascade'),
  ('equipment_inspection_record_attachments.record', 'equipment_inspection_record_attachments', 'record_id', 'equipment_inspection_records', 'equipment_inspection_record_attachments_tenant_record_fk', 'equipment_inspection_record_attachments_record_id_equipment_inspection_records_id_fk', 'cascade'),
  ('equipment_inspection_record_criteria.answered_by_tenant_user', 'equipment_inspection_record_criteria', 'answered_by_tenant_user_id', 'tenant_users', 'equipment_inspection_record_criteria_tenant_answered_by_fk', 'equipment_inspection_record_criteria_answered_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('equipment_inspection_record_criteria.record', 'equipment_inspection_record_criteria', 'record_id', 'equipment_inspection_records', 'equipment_inspection_record_criteria_tenant_record_fk', 'equipment_inspection_record_criteria_record_id_equipment_inspection_records_id_fk', 'cascade'),
  ('equipment_inspection_record_criteria.work_order', 'equipment_inspection_record_criteria', 'work_order_id', 'equipment_work_orders', 'equipment_inspection_record_criteria_tenant_work_order_fk', 'equipment_inspection_record_criteria_work_order_id_equipment_work_orders_id_fk', 'set null'),
  ('equipment_inspection_records.closed_by_tenant_user', 'equipment_inspection_records', 'closed_by_tenant_user_id', 'tenant_users', 'equipment_inspection_records_tenant_closed_by_fk', 'equipment_inspection_records_closed_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('equipment_inspection_records.equipment_item', 'equipment_inspection_records', 'equipment_item_id', 'equipment_items', 'equipment_inspection_records_tenant_item_fk', 'equipment_inspection_records_equipment_item_id_equipment_items_id_fk', 'cascade'),
  ('equipment_inspection_records.inspection_type', 'equipment_inspection_records', 'inspection_type_id', 'equipment_inspection_types', 'equipment_inspection_records_tenant_inspection_type_fk', 'equipment_inspection_records_inspection_type_id_equipment_inspection_types_id_fk', 'set null'),
  ('equipment_inspection_records.inspector_person', 'equipment_inspection_records', 'inspector_person_id', 'people', 'equipment_inspection_records_tenant_inspector_person_fk', 'equipment_inspection_records_inspector_person_id_people_id_fk', 'set null'),
  ('equipment_inspection_records.inspector_tenant_user', 'equipment_inspection_records', 'inspector_tenant_user_id', 'tenant_users', 'equipment_inspection_records_tenant_inspector_user_fk', 'equipment_inspection_records_inspector_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('equipment_inspection_records.site_org_unit', 'equipment_inspection_records', 'site_org_unit_id', 'org_units', 'equipment_inspection_records_tenant_site_fk', 'equipment_inspection_records_site_org_unit_id_org_units_id_fk', 'no action'),
  ('equipment_inspection_records.submitted_by_tenant_user', 'equipment_inspection_records', 'submitted_by_tenant_user_id', 'tenant_users', 'equipment_inspection_records_tenant_submitted_by_fk', 'equipment_inspection_records_submitted_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('equipment_inspection_records.supervisor_tenant_user', 'equipment_inspection_records', 'supervisor_tenant_user_id', 'tenant_users', 'equipment_inspection_records_tenant_supervisor_fk', 'equipment_inspection_records_supervisor_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('equipment_inspection_records.work_order', 'equipment_inspection_records', 'work_order_id', 'equipment_work_orders', 'equipment_inspection_records_tenant_work_order_fk', 'equipment_inspection_records_work_order_id_equipment_work_orders_id_fk', 'set null'),
  ('equipment_inspection_schedules.created_by_tenant_user', 'equipment_inspection_schedules', 'created_by_tenant_user_id', 'tenant_users', 'equipment_inspection_schedules_tenant_created_by_fk', 'equipment_inspection_schedules_created_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('equipment_inspection_schedules.equipment_item', 'equipment_inspection_schedules', 'equipment_item_id', 'equipment_items', 'equipment_inspection_schedules_tenant_item_fk', 'equipment_inspection_schedules_equipment_item_id_equipment_items_id_fk', 'cascade'),
  ('equipment_inspection_schedules.inspection_type', 'equipment_inspection_schedules', 'inspection_type_id', 'equipment_inspection_types', 'equipment_inspection_schedules_tenant_inspection_type_fk', 'equipment_inspection_schedules_inspection_type_id_equipment_inspection_types_id_fk', 'set null'),
  ('equipment_inspection_types.applies_to_type', 'equipment_inspection_types', 'applies_to_type_id', 'equipment_types', 'equipment_inspection_types_tenant_applies_to_type_fk', 'equipment_inspection_types_applies_to_type_id_equipment_types_id_fk', 'set null'),
  ('equipment_items.category', 'equipment_items', 'category_id', 'equipment_categories', 'equipment_items_tenant_category_fk', 'equipment_items_category_id_equipment_categories_id_fk', 'set null'),
  ('equipment_items.current_holder_person', 'equipment_items', 'current_holder_person_id', 'people', 'equipment_items_tenant_current_holder_fk', 'equipment_items_current_holder_person_id_people_id_fk', 'no action'),
  ('equipment_items.current_site_org_unit', 'equipment_items', 'current_site_org_unit_id', 'org_units', 'equipment_items_tenant_current_site_fk', 'equipment_items_current_site_org_unit_id_org_units_id_fk', 'no action'),
  ('equipment_items.last_seen_holder_person', 'equipment_items', 'last_seen_holder_person_id', 'people', 'equipment_items_tenant_last_seen_holder_fk', 'equipment_items_last_seen_holder_person_id_people_id_fk', 'no action'),
  ('equipment_items.last_seen_site_org_unit', 'equipment_items', 'last_seen_site_org_unit_id', 'org_units', 'equipment_items_tenant_last_seen_site_fk', 'equipment_items_last_seen_site_org_unit_id_org_units_id_fk', 'no action'),
  ('equipment_items.pre_use_inspection_type', 'equipment_items', 'pre_use_inspection_type_id', 'equipment_inspection_types', 'equipment_items_tenant_pre_use_inspection_type_fk', 'equipment_items_pre_use_inspection_type_id_fk', 'set null'),
  ('equipment_items.type', 'equipment_items', 'type_id', 'equipment_types', 'equipment_items_tenant_type_fk', 'equipment_items_type_id_equipment_types_id_fk', 'no action'),
  ('equipment_location_history.holder_person', 'equipment_location_history', 'holder_person_id', 'people', 'equipment_location_history_tenant_holder_fk', 'equipment_location_history_holder_person_id_people_id_fk', 'no action'),
  ('equipment_location_history.item', 'equipment_location_history', 'item_id', 'equipment_items', 'equipment_location_history_tenant_item_fk', 'equipment_location_history_item_id_equipment_items_id_fk', 'cascade'),
  ('equipment_location_history.recorded_by_tenant_user', 'equipment_location_history', 'recorded_by_tenant_user_id', 'tenant_users', 'equipment_location_history_tenant_recorded_by_fk', 'equipment_location_history_recorded_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('equipment_location_history.site_org_unit', 'equipment_location_history', 'site_org_unit_id', 'org_units', 'equipment_location_history_tenant_site_fk', 'equipment_location_history_site_org_unit_id_org_units_id_fk', 'no action'),
  ('equipment_log_entries.created_by_tenant_user', 'equipment_log_entries', 'created_by_tenant_user_id', 'tenant_users', 'equipment_log_entries_tenant_created_by_fk', 'equipment_log_entries_created_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('equipment_log_entries.equipment_item', 'equipment_log_entries', 'equipment_item_id', 'equipment_items', 'equipment_log_entries_tenant_item_fk', 'equipment_log_entries_equipment_item_id_equipment_items_id_fk', 'cascade'),
  ('equipment_log_entries.person', 'equipment_log_entries', 'person_person_id', 'people', 'equipment_log_entries_tenant_person_fk', 'equipment_log_entries_person_person_id_people_id_fk', 'no action'),
  ('equipment_log_entries.site_org_unit', 'equipment_log_entries', 'site_org_unit_id', 'org_units', 'equipment_log_entries_tenant_site_fk', 'equipment_log_entries_site_org_unit_id_org_units_id_fk', 'no action'),
  ('equipment_reminders.assigned_to_person', 'equipment_reminders', 'assigned_to_person_id', 'people', 'equipment_reminders_tenant_assigned_to_fk', 'equipment_reminders_assigned_to_person_id_people_id_fk', 'set null'),
  ('equipment_reminders.completed_by_tenant_user', 'equipment_reminders', 'completed_by_tenant_user_id', 'tenant_users', 'equipment_reminders_tenant_completed_by_fk', 'equipment_reminders_completed_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('equipment_reminders.created_by_tenant_user', 'equipment_reminders', 'created_by_tenant_user_id', 'tenant_users', 'equipment_reminders_tenant_created_by_fk', 'equipment_reminders_created_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('equipment_reminders.equipment_item', 'equipment_reminders', 'equipment_item_id', 'equipment_items', 'equipment_reminders_tenant_item_fk', 'equipment_reminders_equipment_item_id_equipment_items_id_fk', 'cascade'),
  ('equipment_station_settings.default_check_in_org_unit', 'equipment_station_settings', 'default_check_in_org_unit_id', 'org_units', 'equipment_station_settings_tenant_default_org_unit_fk', 'equipment_station_settings_default_check_in_org_unit_id_org_units_id_fk', 'set null'),
  ('equipment_types.category', 'equipment_types', 'category_id', 'equipment_categories', 'equipment_types_tenant_category_fk', 'equipment_types_category_id_equipment_categories_id_fk', 'set null'),
  ('equipment_work_orders.assigned_to_tenant_user', 'equipment_work_orders', 'assigned_to_tenant_user_id', 'tenant_users', 'equipment_work_orders_tenant_assigned_to_fk', 'equipment_work_orders_assigned_to_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('equipment_work_orders.item', 'equipment_work_orders', 'item_id', 'equipment_items', 'equipment_work_orders_tenant_item_fk', 'equipment_work_orders_item_id_equipment_items_id_fk', 'cascade'),
  ('equipment_work_orders.opened_by_tenant_user', 'equipment_work_orders', 'opened_by_tenant_user_id', 'tenant_users', 'equipment_work_orders_tenant_opened_by_fk', 'equipment_work_orders_opened_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('equipment_work_orders.reported_by_person', 'equipment_work_orders', 'reported_by_person_id', 'people', 'equipment_work_orders_tenant_reported_by_fk', 'equipment_work_orders_reported_by_person_id_people_id_fk', 'no action'),
  ('truck_log_entries.created_by_tenant_user', 'truck_log_entries', 'created_by_tenant_user_id', 'tenant_users', 'truck_log_entries_tenant_created_by_fk', 'truck_log_entries_created_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('truck_log_entries.driver_person', 'truck_log_entries', 'driver_person_id', 'people', 'truck_log_entries_tenant_driver_fk', 'truck_log_entries_driver_person_id_people_id_fk', 'no action'),
  ('truck_log_entries.equipment_item', 'truck_log_entries', 'equipment_item_id', 'equipment_items', 'truck_log_entries_tenant_item_fk', 'truck_log_entries_equipment_item_id_equipment_items_id_fk', 'cascade'),
  ('truck_log_entries.site_org_unit', 'truck_log_entries', 'site_org_unit_id', 'org_units', 'truck_log_entries_tenant_site_fk', 'truck_log_entries_site_org_unit_id_org_units_id_fk', 'no action'),
  ('truck_log_entries.source_connection', 'truck_log_entries', 'source_connection_id', 'sync_connections', 'truck_log_entries_tenant_source_connection_fk', 'truck_log_entries_source_connection_id_sync_connections_id_fk', 'set null');--> statement-breakpoint

-- migrate.ts SET ROLEs to the NOLOGIN owner, while tenant tables use FORCE
-- RLS. Transactionally relax FORCE (RLS remains enabled for non-owners), scan
-- as the owner, and restore FORCE before durable application-schema DDL.
ALTER TABLE "tenant_users" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_units" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_connections" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_categories" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_types" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_items" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_location_history" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_work_orders" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "truck_log_entries" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_log_entries" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_inspection_types" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_inspection_groups" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_inspection_criteria" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_inspection_records" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_inspection_record_attachments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_inspection_record_criteria" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_inspection_schedules" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_reminders" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_checkouts" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_station_settings" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DO $$
DECLARE
  relationship record;
  violation_count bigint;
  violations text[] := ARRAY[]::text[];
BEGIN
  FOR relationship IN
    SELECT * FROM "equipment_relationship_hardening" ORDER BY "ordinal"
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I child LEFT JOIN %I parent ON parent.%I = child.%I WHERE child.%I IS NOT NULL AND (parent.%I IS NULL OR child.%I IS DISTINCT FROM parent.%I)',
      relationship."child_table",
      relationship."parent_table",
      'id',
      relationship."child_column",
      relationship."child_column",
      'id',
      'tenant_id',
      'tenant_id'
    ) INTO violation_count;

    IF violation_count > 0 THEN
      violations := array_append(
        violations,
        format('%s=%s', relationship."relation_name", violation_count)
      );
    END IF;
  END LOOP;

  IF cardinality(violations) > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'Equipment tenant/relation integrity preflight failed: %s',
        array_to_string(violations, ', ')
      );
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "tenant_users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_location_history" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_work_orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "truck_log_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_log_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_inspection_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_inspection_groups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_inspection_criteria" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_inspection_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_inspection_record_attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_inspection_record_criteria" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_inspection_schedules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_reminders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_checkouts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_station_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Exact parent keys required by the new composite foreign keys.
CREATE UNIQUE INDEX "equipment_categories_tenant_id_id_ux" ON "equipment_categories" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_types_tenant_id_id_ux" ON "equipment_types" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_items_tenant_id_id_ux" ON "equipment_items" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_work_orders_tenant_id_id_ux" ON "equipment_work_orders" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_inspection_types_tenant_id_id_ux" ON "equipment_inspection_types" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_inspection_groups_tenant_id_id_ux" ON "equipment_inspection_groups" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_inspection_records_tenant_id_id_ux" ON "equipment_inspection_records" USING btree ("tenant_id","id");--> statement-breakpoint

-- Rebuild existing child indexes whose old leading column was not tenant_id.
DROP INDEX "equipment_location_history_item_idx";--> statement-breakpoint
DROP INDEX "equipment_work_orders_item_idx";--> statement-breakpoint
DROP INDEX "truck_log_truck_idx";--> statement-breakpoint
DROP INDEX "equipment_log_entries_item_idx";--> statement-breakpoint
DROP INDEX "equipment_inspection_criteria_type_seq_idx";--> statement-breakpoint
DROP INDEX "equipment_inspection_criteria_group_idx";--> statement-breakpoint
DROP INDEX "equipment_inspection_groups_type_seq_idx";--> statement-breakpoint
DROP INDEX "equipment_inspection_record_attachments_record_idx";--> statement-breakpoint
DROP INDEX "equipment_inspection_record_criteria_record_idx";--> statement-breakpoint
DROP INDEX "equipment_inspection_schedules_item_idx";--> statement-breakpoint
DROP INDEX "equipment_reminders_item_idx";--> statement-breakpoint
DROP INDEX "equipment_checkouts_item_idx";--> statement-breakpoint

CREATE INDEX "equipment_items_type_idx" ON "equipment_items" USING btree ("tenant_id","type_id");--> statement-breakpoint
CREATE INDEX "equipment_items_holder_idx" ON "equipment_items" USING btree ("tenant_id","current_holder_person_id");--> statement-breakpoint
CREATE INDEX "equipment_items_last_seen_site_idx" ON "equipment_items" USING btree ("tenant_id","last_seen_site_org_unit_id");--> statement-breakpoint
CREATE INDEX "equipment_items_last_seen_holder_idx" ON "equipment_items" USING btree ("tenant_id","last_seen_holder_person_id");--> statement-breakpoint
CREATE INDEX "equipment_items_pre_use_inspection_type_idx" ON "equipment_items" USING btree ("tenant_id","pre_use_inspection_type_id");--> statement-breakpoint
CREATE INDEX "equipment_location_history_site_idx" ON "equipment_location_history" USING btree ("tenant_id","site_org_unit_id");--> statement-breakpoint
CREATE INDEX "equipment_location_history_holder_idx" ON "equipment_location_history" USING btree ("tenant_id","holder_person_id");--> statement-breakpoint
CREATE INDEX "equipment_location_history_recorded_by_idx" ON "equipment_location_history" USING btree ("tenant_id","recorded_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "equipment_work_orders_reported_by_idx" ON "equipment_work_orders" USING btree ("tenant_id","reported_by_person_id");--> statement-breakpoint
CREATE INDEX "equipment_work_orders_opened_by_idx" ON "equipment_work_orders" USING btree ("tenant_id","opened_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "equipment_work_orders_assigned_to_idx" ON "equipment_work_orders" USING btree ("tenant_id","assigned_to_tenant_user_id");--> statement-breakpoint
CREATE INDEX "truck_log_created_by_idx" ON "truck_log_entries" USING btree ("tenant_id","created_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "equipment_log_entries_site_idx" ON "equipment_log_entries" USING btree ("tenant_id","site_org_unit_id");--> statement-breakpoint
CREATE INDEX "equipment_log_entries_person_idx" ON "equipment_log_entries" USING btree ("tenant_id","person_person_id");--> statement-breakpoint
CREATE INDEX "equipment_log_entries_created_by_idx" ON "equipment_log_entries" USING btree ("tenant_id","created_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_record_criteria_answered_by_idx" ON "equipment_inspection_record_criteria" USING btree ("tenant_id","answered_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_record_criteria_work_order_idx" ON "equipment_inspection_record_criteria" USING btree ("tenant_id","work_order_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_records_site_idx" ON "equipment_inspection_records" USING btree ("tenant_id","site_org_unit_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_records_inspector_user_idx" ON "equipment_inspection_records" USING btree ("tenant_id","inspector_tenant_user_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_records_inspector_person_idx" ON "equipment_inspection_records" USING btree ("tenant_id","inspector_person_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_records_supervisor_idx" ON "equipment_inspection_records" USING btree ("tenant_id","supervisor_tenant_user_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_records_work_order_idx" ON "equipment_inspection_records" USING btree ("tenant_id","work_order_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_records_submitted_by_idx" ON "equipment_inspection_records" USING btree ("tenant_id","submitted_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_records_closed_by_idx" ON "equipment_inspection_records" USING btree ("tenant_id","closed_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_schedules_created_by_idx" ON "equipment_inspection_schedules" USING btree ("tenant_id","created_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "equipment_reminders_assigned_to_idx" ON "equipment_reminders" USING btree ("tenant_id","assigned_to_person_id");--> statement-breakpoint
CREATE INDEX "equipment_reminders_completed_by_idx" ON "equipment_reminders" USING btree ("tenant_id","completed_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "equipment_reminders_created_by_idx" ON "equipment_reminders" USING btree ("tenant_id","created_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "equipment_checkouts_destination_idx" ON "equipment_checkouts" USING btree ("tenant_id","destination_org_unit_id");--> statement-breakpoint
CREATE INDEX "equipment_checkouts_checked_out_by_idx" ON "equipment_checkouts" USING btree ("tenant_id","checked_out_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "equipment_checkouts_checked_in_by_idx" ON "equipment_checkouts" USING btree ("tenant_id","checked_in_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "equipment_station_settings_default_org_unit_idx" ON "equipment_station_settings" USING btree ("tenant_id","default_check_in_org_unit_id");--> statement-breakpoint
CREATE INDEX "equipment_location_history_item_idx" ON "equipment_location_history" USING btree ("tenant_id","item_id","recorded_at");--> statement-breakpoint
CREATE INDEX "equipment_work_orders_item_idx" ON "equipment_work_orders" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "truck_log_truck_idx" ON "truck_log_entries" USING btree ("tenant_id","equipment_item_id","entry_date");--> statement-breakpoint
CREATE INDEX "equipment_log_entries_item_idx" ON "equipment_log_entries" USING btree ("tenant_id","equipment_item_id","entry_date");--> statement-breakpoint
CREATE INDEX "equipment_inspection_criteria_type_seq_idx" ON "equipment_inspection_criteria" USING btree ("tenant_id","inspection_type_id","sequence");--> statement-breakpoint
CREATE INDEX "equipment_inspection_criteria_group_idx" ON "equipment_inspection_criteria" USING btree ("tenant_id","group_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_groups_type_seq_idx" ON "equipment_inspection_groups" USING btree ("tenant_id","inspection_type_id","sequence");--> statement-breakpoint
CREATE INDEX "equipment_inspection_record_attachments_record_idx" ON "equipment_inspection_record_attachments" USING btree ("tenant_id","record_id");--> statement-breakpoint
CREATE INDEX "equipment_inspection_record_criteria_record_idx" ON "equipment_inspection_record_criteria" USING btree ("tenant_id","record_id","sequence");--> statement-breakpoint
CREATE INDEX "equipment_inspection_schedules_item_idx" ON "equipment_inspection_schedules" USING btree ("tenant_id","equipment_item_id");--> statement-breakpoint
CREATE INDEX "equipment_reminders_item_idx" ON "equipment_reminders" USING btree ("tenant_id","equipment_item_id");--> statement-breakpoint
CREATE INDEX "equipment_checkouts_item_idx" ON "equipment_checkouts" USING btree ("tenant_id","equipment_item_id","checked_out_at");--> statement-breakpoint

-- Add every stronger key as NOT VALID first. PostgreSQL can continue enforcing
-- the legacy existence-only keys until every tenant-aware key has validated.
DO $$
DECLARE
  relationship record;
  delete_sql text;
BEGIN
  FOR relationship IN
    SELECT * FROM "equipment_relationship_hardening" ORDER BY "ordinal"
  LOOP
    delete_sql := CASE relationship."delete_action"
      WHEN 'set null' THEN format('SET NULL (%I)', relationship."child_column")
      WHEN 'cascade' THEN 'CASCADE'
      ELSE 'NO ACTION'
    END;

    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I, %I) REFERENCES public.%I (%I, %I) ON DELETE %s ON UPDATE NO ACTION NOT VALID',
      relationship."child_table",
      relationship."constraint_name",
      'tenant_id',
      relationship."child_column",
      relationship."parent_table",
      'tenant_id',
      'id',
      delete_sql
    );
  END LOOP;
END $$;--> statement-breakpoint

-- Validate all stronger keys before retiring even one legacy constraint.
DO $$
DECLARE
  relationship record;
BEGIN
  FOR relationship IN
    SELECT * FROM "equipment_relationship_hardening" ORDER BY "ordinal"
  LOOP
    EXECUTE format(
      'ALTER TABLE %I VALIDATE CONSTRAINT %I',
      relationship."child_table",
      relationship."constraint_name"
    );
  END LOOP;
END $$;--> statement-breakpoint

DO $$
DECLARE
  relationship record;
BEGIN
  FOR relationship IN
    SELECT * FROM "equipment_relationship_hardening" ORDER BY "ordinal"
  LOOP
    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT %I',
      relationship."child_table",
      relationship."legacy_constraint"
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- Squashed source: packages/db/drizzle/0010_chilly_proudstar.sql
-- Version numbers are allocated per document. The publishing transaction also
-- serializes on the parent document row, while this unique index is the final
-- database invariant preventing duplicate numbers under any write path.
-- migrate.ts SET ROLEs to the NOLOGIN owner and this table uses FORCE RLS, so
-- transactionally relax FORCE for the all-tenant duplicate scan. RLS remains
-- enabled for non-owners throughout.
ALTER TABLE "document_versions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DO $$
DECLARE
  duplicate_groups bigint;
  excess_rows bigint;
BEGIN
  SELECT count(*), coalesce(sum(group_size - 1), 0)
  INTO duplicate_groups, excess_rows
  FROM (
    SELECT count(*) AS group_size
    FROM "document_versions"
    GROUP BY "document_id", "version"
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'Document version uniqueness preflight failed: %s duplicate key group(s), %s excess row(s)',
        duplicate_groups,
        excess_rows
      );
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "document_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DROP INDEX "document_versions_document_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_document_idx" ON "document_versions" USING btree ("document_id","version");
--> statement-breakpoint

-- Squashed source: packages/db/drizzle/0011_famous_hammerhead.sql
-- The document system is tenant-owned end to end. This manifest drives the
-- all-tenant preflight and the complete install/validate/retire sequence for
-- all 25 legacy existence-only foreign keys while preserving delete behavior.
CREATE TEMP TABLE "document_relationship_hardening" (
  "ordinal" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "relation_name" text NOT NULL,
  "child_table" text NOT NULL,
  "child_column" text NOT NULL,
  "parent_table" text NOT NULL,
  "constraint_name" text NOT NULL,
  "legacy_constraint" text NOT NULL,
  "delete_action" text NOT NULL CHECK ("delete_action" IN ('cascade', 'no action', 'set null'))
) ON COMMIT DROP;--> statement-breakpoint

INSERT INTO "document_relationship_hardening" (
  "relation_name", "child_table", "child_column", "parent_table",
  "constraint_name", "legacy_constraint", "delete_action"
) VALUES
  ('document_acknowledgment_sessions.conducted_by_tenant_user', 'document_acknowledgment_sessions', 'conducted_by_tenant_user_id', 'tenant_users', 'document_ack_sessions_tenant_conducted_by_fk', 'document_acknowledgment_sessions_conducted_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('document_acknowledgment_sessions.document', 'document_acknowledgment_sessions', 'document_id', 'documents', 'document_ack_sessions_tenant_document_fk', 'document_acknowledgment_sessions_document_id_documents_id_fk', 'cascade'),
  ('document_acknowledgment_sessions.version', 'document_acknowledgment_sessions', 'version_id', 'document_versions', 'document_ack_sessions_tenant_version_fk', 'document_acknowledgment_sessions_version_id_document_versions_id_fk', 'no action'),
  ('document_acknowledgments.document', 'document_acknowledgments', 'document_id', 'documents', 'document_acks_tenant_document_fk', 'document_acknowledgments_document_id_documents_id_fk', 'cascade'),
  ('document_acknowledgments.person', 'document_acknowledgments', 'person_id', 'people', 'document_acks_tenant_person_fk', 'document_acknowledgments_person_id_people_id_fk', 'cascade'),
  ('document_acknowledgments.session', 'document_acknowledgments', 'session_id', 'document_acknowledgment_sessions', 'document_acks_tenant_session_fk', 'document_acknowledgments_session_id_document_acknowledgment_sessions_id_fk', 'set null'),
  ('document_acknowledgments.version', 'document_acknowledgments', 'version_id', 'document_versions', 'document_acks_tenant_version_fk', 'document_acknowledgments_version_id_document_versions_id_fk', 'no action'),
  ('document_assignment_audience.assignment', 'document_assignment_audience', 'assignment_id', 'document_assignments', 'document_assignment_audience_tenant_assignment_fk', 'document_assignment_audience_assignment_id_document_assignments_id_fk', 'cascade'),
  ('document_assignments.assigned_by_tenant_user', 'document_assignments', 'assigned_by_tenant_user_id', 'tenant_users', 'document_assignments_tenant_assigned_by_fk', 'document_assignments_assigned_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('document_assignments.document', 'document_assignments', 'document_id', 'documents', 'document_assignments_tenant_document_fk', 'document_assignments_document_id_documents_id_fk', 'cascade'),
  ('document_book_items.book', 'document_book_items', 'book_id', 'document_books', 'document_book_items_tenant_book_fk', 'document_book_items_book_id_document_books_id_fk', 'cascade'),
  ('document_book_items.document', 'document_book_items', 'document_id', 'documents', 'document_book_items_tenant_document_fk', 'document_book_items_document_id_documents_id_fk', 'cascade'),
  ('document_books.category', 'document_books', 'category_id', 'document_categories', 'document_books_tenant_category_fk', 'document_books_category_id_document_categories_id_fk', 'no action'),
  ('document_books.type', 'document_books', 'type_id', 'document_types', 'document_books_tenant_type_fk', 'document_books_type_id_document_types_id_fk', 'no action'),
  ('document_categories.parent', 'document_categories', 'parent_id', 'document_categories', 'document_categories_tenant_parent_fk', 'document_categories_parent_id_document_categories_id_fk', 'set null'),
  ('document_management_reviews.chaired_by_tenant_user', 'document_management_reviews', 'chaired_by_tenant_user_id', 'tenant_users', 'document_management_reviews_tenant_chaired_by_fk', 'document_management_reviews_chaired_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('document_management_reviews.created_by_tenant_user', 'document_management_reviews', 'created_by_tenant_user_id', 'tenant_users', 'document_management_reviews_tenant_created_by_fk', 'document_management_reviews_created_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('document_reviews.document', 'document_reviews', 'document_id', 'documents', 'document_reviews_tenant_document_fk', 'document_reviews_document_id_documents_id_fk', 'cascade'),
  ('document_reviews.reviewed_by_tenant_user', 'document_reviews', 'reviewed_by_tenant_user_id', 'tenant_users', 'document_reviews_tenant_reviewed_by_fk', 'document_reviews_reviewed_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('document_versions.document', 'document_versions', 'document_id', 'documents', 'document_versions_tenant_document_fk', 'document_versions_document_id_documents_id_fk', 'cascade'),
  ('documents.category', 'documents', 'category_id', 'document_categories', 'documents_tenant_category_fk', 'documents_category_id_document_categories_id_fk', 'no action'),
  ('documents.owner_tenant_user', 'documents', 'owner_tenant_user_id', 'tenant_users', 'documents_tenant_owner_fk', 'documents_owner_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('documents.type', 'documents', 'type_id', 'document_types', 'documents_tenant_type_fk', 'documents_type_id_document_types_id_fk', 'no action');--> statement-breakpoint

-- The migration owner is intentionally NOBYPASSRLS. Transactionally relax
-- FORCE so the owner can inspect every tenant, while RLS remains enabled for
-- all non-owner sessions, then restore FORCE before durable schema changes.
ALTER TABLE "tenant_users" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_versions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_acknowledgment_sessions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_acknowledgments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_books" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_reviews" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_types" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_categories" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_book_items" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_assignments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_assignment_audience" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_management_reviews" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DO $$
DECLARE
  relationship record;
  violation_count bigint;
  violations text[] := ARRAY[]::text[];
BEGIN
  FOR relationship IN
    SELECT * FROM "document_relationship_hardening" ORDER BY "ordinal"
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I child LEFT JOIN %I parent ON parent.%I = child.%I WHERE child.%I IS NOT NULL AND (parent.%I IS NULL OR child.%I IS DISTINCT FROM parent.%I)',
      relationship."child_table", relationship."parent_table", 'id',
      relationship."child_column", relationship."child_column", 'id',
      'tenant_id', 'tenant_id'
    ) INTO violation_count;

    IF violation_count > 0 THEN
      violations := array_append(
        violations,
        format('%s=%s', relationship."relation_name", violation_count)
      );
    END IF;
  END LOOP;

  IF cardinality(violations) > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'Document tenant/relation integrity preflight failed: %s',
        array_to_string(violations, ', ')
      );
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "tenant_users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_acknowledgment_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_acknowledgments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_books" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_reviews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_book_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_assignment_audience" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_management_reviews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE UNIQUE INDEX "documents_tenant_id_id_ux" ON "documents" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_tenant_id_id_ux" ON "document_versions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_ack_sessions_tenant_id_id_ux" ON "document_acknowledgment_sessions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_books_tenant_id_id_ux" ON "document_books" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_types_tenant_id_id_ux" ON "document_types" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_categories_tenant_id_id_ux" ON "document_categories" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_assignments_tenant_id_id_ux" ON "document_assignments" USING btree ("tenant_id","id");--> statement-breakpoint

DROP INDEX "document_ack_sessions_doc_idx";--> statement-breakpoint
DROP INDEX "document_acks_doc_person_idx";--> statement-breakpoint
DROP INDEX "document_acks_session_idx";--> statement-breakpoint
DROP INDEX "document_reviews_doc_idx";--> statement-breakpoint
DROP INDEX "document_book_items_book_idx";--> statement-breakpoint
DROP INDEX "document_categories_parent_idx";--> statement-breakpoint
DROP INDEX "document_assignment_audience_assignment_idx";--> statement-breakpoint

CREATE INDEX "document_ack_sessions_version_idx" ON "document_acknowledgment_sessions" USING btree ("tenant_id","version_id");--> statement-breakpoint
CREATE INDEX "document_ack_sessions_conducted_by_idx" ON "document_acknowledgment_sessions" USING btree ("tenant_id","conducted_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "document_acks_version_idx" ON "document_acknowledgments" USING btree ("tenant_id","version_id");--> statement-breakpoint
CREATE INDEX "document_acks_person_idx" ON "document_acknowledgments" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "document_books_type_idx" ON "document_books" USING btree ("tenant_id","type_id");--> statement-breakpoint
CREATE INDEX "document_books_category_idx" ON "document_books" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE INDEX "document_reviews_reviewed_by_idx" ON "document_reviews" USING btree ("tenant_id","reviewed_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "document_versions_tenant_document_idx" ON "document_versions" USING btree ("tenant_id","document_id");--> statement-breakpoint
CREATE INDEX "documents_type_idx" ON "documents" USING btree ("tenant_id","type_id");--> statement-breakpoint
CREATE INDEX "documents_category_idx" ON "documents" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE INDEX "documents_owner_idx" ON "documents" USING btree ("tenant_id","owner_tenant_user_id");--> statement-breakpoint
CREATE INDEX "document_book_items_document_idx" ON "document_book_items" USING btree ("tenant_id","document_id");--> statement-breakpoint
CREATE INDEX "document_assignments_assigned_by_idx" ON "document_assignments" USING btree ("tenant_id","assigned_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "document_management_reviews_chaired_by_idx" ON "document_management_reviews" USING btree ("tenant_id","chaired_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "document_management_reviews_created_by_idx" ON "document_management_reviews" USING btree ("tenant_id","created_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "document_ack_sessions_doc_idx" ON "document_acknowledgment_sessions" USING btree ("tenant_id","document_id");--> statement-breakpoint
CREATE INDEX "document_acks_doc_person_idx" ON "document_acknowledgments" USING btree ("tenant_id","document_id","person_id");--> statement-breakpoint
CREATE INDEX "document_acks_session_idx" ON "document_acknowledgments" USING btree ("tenant_id","session_id");--> statement-breakpoint
CREATE INDEX "document_reviews_doc_idx" ON "document_reviews" USING btree ("tenant_id","document_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "document_book_items_book_idx" ON "document_book_items" USING btree ("tenant_id","book_id","position");--> statement-breakpoint
CREATE INDEX "document_categories_parent_idx" ON "document_categories" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE INDEX "document_assignment_audience_assignment_idx" ON "document_assignment_audience" USING btree ("tenant_id","assignment_id");--> statement-breakpoint

DO $$
DECLARE
  relationship record;
  delete_sql text;
BEGIN
  FOR relationship IN
    SELECT * FROM "document_relationship_hardening" ORDER BY "ordinal"
  LOOP
    delete_sql := CASE relationship."delete_action"
      WHEN 'set null' THEN format('SET NULL (%I)', relationship."child_column")
      WHEN 'cascade' THEN 'CASCADE'
      ELSE 'NO ACTION'
    END;
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I, %I) REFERENCES public.%I (%I, %I) ON DELETE %s ON UPDATE NO ACTION NOT VALID',
      relationship."child_table", relationship."constraint_name", 'tenant_id',
      relationship."child_column", relationship."parent_table", 'tenant_id',
      'id', delete_sql
    );
  END LOOP;
END $$;--> statement-breakpoint

DO $$
DECLARE
  relationship record;
BEGIN
  FOR relationship IN
    SELECT * FROM "document_relationship_hardening" ORDER BY "ordinal"
  LOOP
    EXECUTE format(
      'ALTER TABLE %I VALIDATE CONSTRAINT %I',
      relationship."child_table", relationship."constraint_name"
    );
  END LOOP;
END $$;--> statement-breakpoint

DO $$
DECLARE
  relationship record;
BEGIN
  FOR relationship IN
    SELECT * FROM "document_relationship_hardening" ORDER BY "ordinal"
  LOOP
    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT %I',
      relationship."child_table", relationship."legacy_constraint"
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- Squashed source: packages/db/drizzle/0012_organic_vivisector.sql
-- `returned_at IS NULL` is the durable open-checkout state. Before adding the
-- concurrency backstop, fail with an actionable count instead of letting
-- CREATE UNIQUE INDEX stop on an arbitrary duplicate row.
--
-- The migration owner is NOBYPASSRLS. Transactionally relaxing FORCE keeps
-- RLS enabled for non-owner sessions while making every tenant visible to this
-- preflight; FORCE is restored before the durable index is created.
ALTER TABLE "equipment_checkouts" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DO $$
DECLARE
  duplicate_groups bigint;
  excess_rows bigint;
BEGIN
  SELECT count(*), coalesce(sum("row_count" - 1), 0)
    INTO duplicate_groups, excess_rows
  FROM (
    SELECT count(*) AS "row_count"
    FROM "equipment_checkouts"
    WHERE "returned_at" IS NULL
    GROUP BY "tenant_id", "equipment_item_id"
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'Equipment open-checkout uniqueness preflight failed: %s duplicate key group(s), %s excess row(s)',
        duplicate_groups,
        excess_rows
      );
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "equipment_checkouts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE UNIQUE INDEX "equipment_checkouts_open_item_ux" ON "equipment_checkouts" USING btree ("tenant_id","equipment_item_id") WHERE "equipment_checkouts"."returned_at" is null;
--> statement-breakpoint

-- Squashed source: packages/db/drizzle/0013_sour_spyke.sql
-- Incidents, investigation rows, taxonomy, hours, injuries, and principals are
-- tenant-owned end to end. The manifest covers the 25 legacy simple keys plus
-- two previously unenforced relationships: classification ancestry and the
-- typed source Builder response link.
CREATE TEMP TABLE "incident_relationship_hardening" (
  "ordinal" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "relation_name" text NOT NULL,
  "child_table" text NOT NULL,
  "child_column" text NOT NULL,
  "parent_table" text NOT NULL,
  "constraint_name" text NOT NULL,
  "legacy_constraint" text,
  "delete_action" text NOT NULL CHECK ("delete_action" IN ('cascade', 'no action', 'set null'))
) ON COMMIT DROP;--> statement-breakpoint

INSERT INTO "incident_relationship_hardening" (
  "relation_name", "child_table", "child_column", "parent_table",
  "constraint_name", "legacy_constraint", "delete_action"
) VALUES
  ('incident_classifications.created_by_tenant_user', 'incident_classifications', 'created_by_tenant_user_id', 'tenant_users', 'incident_classifications_tenant_created_by_fk', 'incident_classifications_created_by_tenant_user_id_tenant_users_id_fk', 'set null'),
  ('incident_classifications.parent', 'incident_classifications', 'parent_id', 'incident_classifications', 'incident_classifications_tenant_parent_fk', NULL, 'cascade'),
  ('incident_hours_periods.entered_by_tenant_user', 'incident_hours_periods', 'entered_by_tenant_user_id', 'tenant_users', 'incident_hours_periods_tenant_entered_by_fk', 'incident_hours_periods_entered_by_tenant_user_id_tenant_users_id_fk', 'set null'),
  ('incident_hours_periods.site_org_unit', 'incident_hours_periods', 'site_org_unit_id', 'org_units', 'incident_hours_periods_tenant_site_fk', 'incident_hours_periods_site_org_unit_id_org_units_id_fk', 'set null'),
  ('incident_injury_types.created_by_tenant_user', 'incident_injury_types', 'created_by_tenant_user_id', 'tenant_users', 'incident_injury_types_tenant_created_by_fk', 'incident_injury_types_created_by_tenant_user_id_tenant_users_id_fk', 'set null'),
  ('incident_attachments.incident', 'incident_attachments', 'incident_id', 'incidents', 'incident_attachments_tenant_incident_fk', 'incident_attachments_incident_id_incidents_id_fk', 'cascade'),
  ('incident_contributing_factors.incident', 'incident_contributing_factors', 'incident_id', 'incidents', 'incident_contributing_factors_tenant_incident_fk', 'incident_contributing_factors_incident_id_incidents_id_fk', 'cascade'),
  ('incident_events.incident', 'incident_events', 'incident_id', 'incidents', 'incident_events_tenant_incident_fk', 'incident_events_incident_id_incidents_id_fk', 'cascade'),
  ('incident_events.recorded_by_tenant_user', 'incident_events', 'recorded_by_tenant_user_id', 'tenant_users', 'incident_events_tenant_recorded_by_fk', 'incident_events_recorded_by_tenant_user_id_tenant_users_id_fk', 'set null'),
  ('incident_injuries.incident', 'incident_injuries', 'incident_id', 'incidents', 'incident_injuries_tenant_incident_fk', 'incident_injuries_incident_id_incidents_id_fk', 'cascade'),
  ('incident_injuries.injury_type', 'incident_injuries', 'injury_type_id', 'incident_injury_types', 'incident_injuries_tenant_injury_type_fk', 'incident_injuries_injury_type_id_incident_injury_types_id_fk', 'set null'),
  ('incident_injuries.person', 'incident_injuries', 'person_id', 'people', 'incident_injuries_tenant_person_fk', 'incident_injuries_person_id_people_id_fk', 'no action'),
  ('incident_lost_time_events.incident', 'incident_lost_time_events', 'incident_id', 'incidents', 'incident_lost_time_tenant_incident_fk', 'incident_lost_time_events_incident_id_incidents_id_fk', 'cascade'),
  ('incident_lost_time_events.injury', 'incident_lost_time_events', 'injury_id', 'incident_injuries', 'incident_lost_time_tenant_injury_fk', 'incident_lost_time_events_injury_id_incident_injuries_id_fk', 'no action'),
  ('incident_people.incident', 'incident_people', 'incident_id', 'incidents', 'incident_people_tenant_incident_fk', 'incident_people_incident_id_incidents_id_fk', 'cascade'),
  ('incident_people.person', 'incident_people', 'person_id', 'people', 'incident_people_tenant_person_fk', 'incident_people_person_id_people_id_fk', 'no action'),
  ('incident_preventative_steps.incident', 'incident_preventative_steps', 'incident_id', 'incidents', 'incident_preventative_steps_tenant_incident_fk', 'incident_preventative_steps_incident_id_incidents_id_fk', 'cascade'),
  ('incident_preventative_steps.owner_person', 'incident_preventative_steps', 'owner_person_id', 'people', 'incident_preventative_steps_tenant_owner_fk', 'incident_preventative_steps_owner_person_id_people_id_fk', 'set null'),
  ('incident_root_cause_whys.incident', 'incident_root_cause_whys', 'incident_id', 'incidents', 'incident_root_cause_whys_tenant_incident_fk', 'incident_root_cause_whys_incident_id_incidents_id_fk', 'cascade'),
  ('incidents.assigned_investigator_tenant_user', 'incidents', 'assigned_investigator_tenant_user_id', 'tenant_users', 'incidents_tenant_investigator_fk', 'incidents_assigned_investigator_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('incidents.classification', 'incidents', 'classification_id', 'incident_classifications', 'incidents_tenant_classification_fk', 'incidents_classification_id_incident_classifications_id_fk', 'set null'),
  ('incidents.closed_by_tenant_user', 'incidents', 'closed_by_tenant_user_id', 'tenant_users', 'incidents_tenant_closed_by_fk', 'incidents_closed_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('incidents.department', 'incidents', 'department_id', 'departments', 'incidents_tenant_department_fk', 'incidents_department_id_departments_id_fk', 'no action'),
  ('incidents.reported_by_tenant_user', 'incidents', 'reported_by_tenant_user_id', 'tenant_users', 'incidents_tenant_reported_by_fk', 'incidents_reported_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('incidents.site_org_unit', 'incidents', 'site_org_unit_id', 'org_units', 'incidents_tenant_site_fk', 'incidents_site_org_unit_id_org_units_id_fk', 'no action'),
  ('incidents.source_form_response', 'incidents', 'source_form_response_id', 'form_responses', 'incidents_tenant_source_response_fk', NULL, 'set null'),
  ('incidents.supervisor_person', 'incidents', 'supervisor_person_id', 'people', 'incidents_tenant_supervisor_fk', 'incidents_supervisor_person_id_people_id_fk', 'no action');--> statement-breakpoint

-- The migration owner is NOBYPASSRLS. Transactionally relax FORCE so the
-- owner sees every tenant during preflight while RLS remains enabled for all
-- non-owner sessions, then restore FORCE before durable DDL.
ALTER TABLE "tenant_users" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_units" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "departments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_responses" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_classifications" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_hours_periods" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_injury_types" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_attachments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_contributing_factors" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_events" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_injuries" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_lost_time_events" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_people" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_preventative_steps" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_root_cause_whys" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incidents" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DO $$
DECLARE
  relationship record;
  violation_count bigint;
  duplicate_groups bigint;
  excess_rows bigint;
  violations text[] := ARRAY[]::text[];
BEGIN
  FOR relationship IN
    SELECT * FROM "incident_relationship_hardening" ORDER BY "ordinal"
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I child LEFT JOIN %I parent ON parent.%I = child.%I WHERE child.%I IS NOT NULL AND (parent.%I IS NULL OR child.%I IS DISTINCT FROM parent.%I)',
      relationship."child_table", relationship."parent_table", 'id',
      relationship."child_column", relationship."child_column", 'id',
      'tenant_id', 'tenant_id'
    ) INTO violation_count;

    IF violation_count > 0 THEN
      violations := array_append(
        violations,
        format('%s=%s', relationship."relation_name", violation_count)
      );
    END IF;
  END LOOP;

  SELECT count(*), coalesce(sum("row_count" - 1), 0)
    INTO duplicate_groups, excess_rows
  FROM (
    SELECT count(*) AS "row_count"
    FROM "incident_root_cause_whys"
    GROUP BY "tenant_id", "incident_id", "ordinal"
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_groups > 0 THEN
    violations := array_append(
      violations,
      format(
        'incident_root_cause_whys.ordinal_uniqueness=%s group(s)/%s excess row(s)',
        duplicate_groups,
        excess_rows
      )
    );
  END IF;

  IF cardinality(violations) > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'Incident tenant/relation integrity preflight failed: %s',
        array_to_string(violations, ', ')
      );
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "tenant_users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "departments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_responses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_classifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_hours_periods" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_injury_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_contributing_factors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_injuries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_lost_time_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_people" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_preventative_steps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_root_cause_whys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incidents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE UNIQUE INDEX "incident_classifications_tenant_id_id_ux" ON "incident_classifications" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_injury_types_tenant_id_id_ux" ON "incident_injury_types" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_injuries_tenant_id_id_ux" ON "incident_injuries" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_tenant_id_id_ux" ON "incidents" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_tenant_id_id_ux" ON "departments" USING btree ("tenant_id","id");--> statement-breakpoint

DROP INDEX "incident_root_cause_whys_incident_ordinal_idx";--> statement-breakpoint
DROP INDEX "incident_classifications_parent_idx";--> statement-breakpoint
DROP INDEX "incident_attachments_incident_idx";--> statement-breakpoint
DROP INDEX "incident_contributing_factors_incident_idx";--> statement-breakpoint
DROP INDEX "incident_events_incident_idx";--> statement-breakpoint
DROP INDEX "incident_injuries_incident_idx";--> statement-breakpoint
DROP INDEX "incident_injuries_injury_type_idx";--> statement-breakpoint
DROP INDEX "incident_lost_time_incident_idx";--> statement-breakpoint
DROP INDEX "incident_people_incident_idx";--> statement-breakpoint
DROP INDEX "incident_preventative_steps_incident_idx";--> statement-breakpoint
DROP INDEX "incident_root_cause_whys_incident_idx";--> statement-breakpoint

CREATE INDEX "incident_classifications_created_by_idx" ON "incident_classifications" USING btree ("tenant_id","created_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "incident_classifications_parent_idx" ON "incident_classifications" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE INDEX "incident_hours_periods_entered_by_idx" ON "incident_hours_periods" USING btree ("tenant_id","entered_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "incident_injury_types_created_by_idx" ON "incident_injury_types" USING btree ("tenant_id","created_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "incident_attachments_incident_idx" ON "incident_attachments" USING btree ("tenant_id","incident_id");--> statement-breakpoint
CREATE INDEX "incident_contributing_factors_incident_idx" ON "incident_contributing_factors" USING btree ("tenant_id","incident_id");--> statement-breakpoint
CREATE INDEX "incident_events_incident_idx" ON "incident_events" USING btree ("tenant_id","incident_id");--> statement-breakpoint
CREATE INDEX "incident_events_recorded_by_idx" ON "incident_events" USING btree ("tenant_id","recorded_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "incident_injuries_incident_idx" ON "incident_injuries" USING btree ("tenant_id","incident_id");--> statement-breakpoint
CREATE INDEX "incident_injuries_injury_type_idx" ON "incident_injuries" USING btree ("tenant_id","injury_type_id");--> statement-breakpoint
CREATE INDEX "incident_injuries_person_idx" ON "incident_injuries" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "incident_lost_time_incident_idx" ON "incident_lost_time_events" USING btree ("tenant_id","incident_id");--> statement-breakpoint
CREATE INDEX "incident_lost_time_injury_idx" ON "incident_lost_time_events" USING btree ("tenant_id","injury_id");--> statement-breakpoint
CREATE INDEX "incident_people_incident_idx" ON "incident_people" USING btree ("tenant_id","incident_id");--> statement-breakpoint
CREATE INDEX "incident_people_person_idx" ON "incident_people" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "incident_preventative_steps_incident_idx" ON "incident_preventative_steps" USING btree ("tenant_id","incident_id");--> statement-breakpoint
CREATE INDEX "incident_preventative_steps_owner_idx" ON "incident_preventative_steps" USING btree ("tenant_id","owner_person_id");--> statement-breakpoint
CREATE INDEX "incident_root_cause_whys_incident_idx" ON "incident_root_cause_whys" USING btree ("tenant_id","incident_id");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_root_cause_whys_tenant_incident_ordinal_ux" ON "incident_root_cause_whys" USING btree ("tenant_id","incident_id","ordinal");--> statement-breakpoint
CREATE INDEX "incidents_department_idx" ON "incidents" USING btree ("tenant_id","department_id");--> statement-breakpoint
CREATE INDEX "incidents_reported_by_idx" ON "incidents" USING btree ("tenant_id","reported_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "incidents_supervisor_idx" ON "incidents" USING btree ("tenant_id","supervisor_person_id");--> statement-breakpoint
CREATE INDEX "incidents_classification_idx" ON "incidents" USING btree ("tenant_id","classification_id");--> statement-breakpoint
CREATE INDEX "incidents_investigator_idx" ON "incidents" USING btree ("tenant_id","assigned_investigator_tenant_user_id");--> statement-breakpoint
CREATE INDEX "incidents_closed_by_idx" ON "incidents" USING btree ("tenant_id","closed_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "incidents_source_response_idx" ON "incidents" USING btree ("tenant_id","source_form_response_id");--> statement-breakpoint

DO $$
DECLARE
  relationship record;
  delete_sql text;
BEGIN
  FOR relationship IN
    SELECT * FROM "incident_relationship_hardening" ORDER BY "ordinal"
  LOOP
    delete_sql := CASE relationship."delete_action"
      WHEN 'set null' THEN format('SET NULL (%I)', relationship."child_column")
      WHEN 'cascade' THEN 'CASCADE'
      ELSE 'NO ACTION'
    END;
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I, %I) REFERENCES public.%I (%I, %I) ON DELETE %s ON UPDATE NO ACTION NOT VALID',
      relationship."child_table", relationship."constraint_name", 'tenant_id',
      relationship."child_column", relationship."parent_table", 'tenant_id',
      'id', delete_sql
    );
  END LOOP;
END $$;--> statement-breakpoint

DO $$
DECLARE
  relationship record;
BEGIN
  FOR relationship IN
    SELECT * FROM "incident_relationship_hardening" ORDER BY "ordinal"
  LOOP
    EXECUTE format(
      'ALTER TABLE %I VALIDATE CONSTRAINT %I',
      relationship."child_table", relationship."constraint_name"
    );
  END LOOP;
END $$;--> statement-breakpoint

DO $$
DECLARE
  relationship record;
BEGIN
  FOR relationship IN
    SELECT * FROM "incident_relationship_hardening"
    WHERE "legacy_constraint" IS NOT NULL
    ORDER BY "ordinal"
  LOOP
    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT %I',
      relationship."child_table", relationship."legacy_constraint"
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- Squashed source: packages/db/drizzle/0014_natural_captain_marvel.sql
-- Source-only editor cutover. Runtime, raw-SQL, and the private ETL package no
-- longer read the retired GrapesJS project payloads. Email/PDF templates keep
-- sanitized source_html plus compiled_html. The earlier 0005 section already
-- performs the training JSON cutover in this same atomic migration.
ALTER TABLE "email_templates" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DO $$
DECLARE
  old_email_source_exists boolean;
  new_email_source_exists boolean;
  conflicting_email_rows bigint;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'email_templates'
      AND column_name = 'mjml_source'
  ) INTO old_email_source_exists;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'email_templates'
      AND column_name = 'source_html'
  ) INTO new_email_source_exists;

  IF old_email_source_exists AND new_email_source_exists THEN
    EXECUTE $query$
      SELECT count(*)
      FROM email_templates
      WHERE NULLIF(btrim(mjml_source), '') IS NOT NULL
        AND NULLIF(btrim(source_html), '') IS NOT NULL
        AND mjml_source IS DISTINCT FROM source_html
    $query$ INTO conflicting_email_rows;
    IF conflicting_email_rows > 0 THEN
      RAISE EXCEPTION
        'Cannot converge email template HTML columns: % row(s) have conflicting mjml_source and source_html',
        conflicting_email_rows;
    END IF;

    EXECUTE $query$
      UPDATE email_templates
      SET source_html = mjml_source
      WHERE NULLIF(btrim(source_html), '') IS NULL
        AND NULLIF(btrim(mjml_source), '') IS NOT NULL
    $query$;
  ELSIF NOT old_email_source_exists AND NOT new_email_source_exists THEN
    RAISE EXCEPTION
      'Cannot complete email template source cutover: neither mjml_source nor source_html exists';
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "email_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Perform the catalog transition only after FORCE is restored. The preflight
-- above has already rejected conflicts and copied any missing canonical value.
DO $$
DECLARE
  old_email_source_exists boolean;
  new_email_source_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'email_templates'
      AND column_name = 'mjml_source'
  ) INTO old_email_source_exists;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'email_templates'
      AND column_name = 'source_html'
  ) INTO new_email_source_exists;

  IF old_email_source_exists AND new_email_source_exists THEN
    EXECUTE 'ALTER TABLE email_templates DROP COLUMN mjml_source';
  ELSIF old_email_source_exists THEN
    EXECUTE 'ALTER TABLE email_templates RENAME COLUMN mjml_source TO source_html';
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "email_templates" DROP COLUMN IF EXISTS "design";--> statement-breakpoint
ALTER TABLE "pdf_templates" DROP COLUMN IF EXISTS "design";
--> statement-breakpoint

-- Squashed source: packages/db/drizzle/0015_zippy_mac_gargan.sql
-- Training is tenant-owned end to end. Replace all 49 legacy existence-only
-- foreign keys with tenant-qualified keys while preserving each relationship's
-- established delete behavior. The manifest is also the migration's auditable
-- source of truth for preflight, creation, validation, and legacy-key removal.
CREATE TEMP TABLE "training_relationship_hardening" (
  "ordinal" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "relation_name" text NOT NULL,
  "child_table" text NOT NULL,
  "child_column" text NOT NULL,
  "parent_table" text NOT NULL,
  "constraint_name" text NOT NULL,
  "legacy_constraint" text NOT NULL,
  "delete_action" text NOT NULL CHECK (
    "delete_action" IN ('cascade', 'no action', 'restrict', 'set null')
  )
) ON COMMIT DROP;--> statement-breakpoint

INSERT INTO "training_relationship_hardening" (
  "relation_name", "child_table", "child_column", "parent_table",
  "constraint_name", "legacy_constraint", "delete_action"
) VALUES
  ('training_certificates.record', 'training_certificates', 'record_id', 'training_records', 'training_certificates_tenant_record_fk', 'training_certificates_record_id_training_records_id_fk', 'cascade'),
  ('training_class_attendees.class', 'training_class_attendees', 'class_id', 'training_classes', 'training_class_attendees_tenant_class_fk', 'training_class_attendees_class_id_training_classes_id_fk', 'cascade'),
  ('training_class_attendees.person', 'training_class_attendees', 'person_id', 'people', 'training_class_attendees_tenant_person_fk', 'training_class_attendees_person_id_people_id_fk', 'cascade'),
  ('training_classes.course', 'training_classes', 'course_id', 'training_courses', 'training_classes_tenant_course_fk', 'training_classes_course_id_training_courses_id_fk', 'cascade'),
  ('training_classes.site', 'training_classes', 'site_org_unit_id', 'org_units', 'training_classes_tenant_site_fk', 'training_classes_site_org_unit_id_org_units_id_fk', 'no action'),
  ('training_classes.instructor', 'training_classes', 'instructor_tenant_user_id', 'tenant_users', 'training_classes_tenant_instructor_fk', 'training_classes_instructor_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('training_records.person', 'training_records', 'person_id', 'people', 'training_records_tenant_person_fk', 'training_records_person_id_people_id_fk', 'cascade'),
  ('training_records.course', 'training_records', 'course_id', 'training_courses', 'training_records_tenant_course_fk', 'training_records_course_id_training_courses_id_fk', 'no action'),
  ('training_records.class', 'training_records', 'class_id', 'training_classes', 'training_records_tenant_class_fk', 'training_records_class_id_training_classes_id_fk', 'no action'),
  ('training_records.evaluator', 'training_records', 'evaluator_person_id', 'people', 'training_records_tenant_evaluator_fk', 'training_records_evaluator_person_id_people_id_fk', 'no action'),
  ('training_records.issued_by', 'training_records', 'issued_by_tenant_user_id', 'tenant_users', 'training_records_tenant_issued_by_fk', 'training_records_issued_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('training_skill_assignment_files.assignment', 'training_skill_assignment_files', 'skill_assignment_id', 'training_skill_assignments', 'training_skill_assignment_files_tenant_assignment_fk', 'training_skill_assignment_files_skill_assignment_id_training_skill_assignments_id_fk', 'cascade'),
  ('training_skill_assignments.person', 'training_skill_assignments', 'person_id', 'people', 'training_skill_assignments_tenant_person_fk', 'training_skill_assignments_person_id_people_id_fk', 'cascade'),
  ('training_skill_assignments.skill_type', 'training_skill_assignments', 'skill_type_id', 'training_skill_types', 'training_skill_assignments_tenant_skill_type_fk', 'training_skill_assignments_skill_type_id_training_skill_types_id_fk', 'cascade'),
  ('training_skill_assignments.granted_by', 'training_skill_assignments', 'granted_by_tenant_user_id', 'tenant_users', 'training_skill_assignments_tenant_granted_by_fk', 'training_skill_assignments_granted_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('training_skill_certificates.assignment', 'training_skill_certificates', 'skill_assignment_id', 'training_skill_assignments', 'training_skill_certificates_tenant_assignment_fk', 'training_skill_certificates_skill_assignment_id_training_skill_assignments_id_fk', 'cascade'),
  ('training_skill_types.authority', 'training_skill_types', 'authority_id', 'training_skill_authorities', 'training_skill_types_tenant_authority_fk', 'training_skill_types_authority_id_training_skill_authorities_id_fk', 'cascade'),
  ('training_assessment_results.assessment', 'training_assessment_results', 'assessment_id', 'training_assessments', 'training_assessment_results_tenant_assessment_fk', 'training_assessment_results_assessment_id_training_assessments_id_fk', 'cascade'),
  ('training_assessment_results.question', 'training_assessment_results', 'question_id', 'training_assessment_type_questions', 'training_assessment_results_tenant_question_fk', 'training_assessment_results_question_id_training_assessment_type_questions_id_fk', 'restrict'),
  ('training_assessment_type_questions.type', 'training_assessment_type_questions', 'type_id', 'training_assessment_types', 'training_assessment_type_questions_tenant_type_fk', 'training_assessment_type_questions_type_id_training_assessment_types_id_fk', 'cascade'),
  ('training_assessment_types.course', 'training_assessment_types', 'course_id', 'training_courses', 'training_assessment_types_tenant_course_fk', 'training_assessment_types_course_id_training_courses_id_fk', 'set null'),
  ('training_assessment_types.created_by', 'training_assessment_types', 'created_by_tenant_user_id', 'tenant_users', 'training_assessment_types_tenant_created_by_fk', 'training_assessment_types_created_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('training_assessments.type', 'training_assessments', 'type_id', 'training_assessment_types', 'training_assessments_tenant_type_fk', 'training_assessments_type_id_training_assessment_types_id_fk', 'restrict'),
  ('training_assessments.person', 'training_assessments', 'person_id', 'people', 'training_assessments_tenant_person_fk', 'training_assessments_person_id_people_id_fk', 'cascade'),
  ('training_assessments.course', 'training_assessments', 'course_id', 'training_courses', 'training_assessments_tenant_course_fk', 'training_assessments_course_id_training_courses_id_fk', 'set null'),
  ('training_assessments.submitted_by', 'training_assessments', 'submitted_by_tenant_user_id', 'tenant_users', 'training_assessments_tenant_submitted_by_fk', 'training_assessments_submitted_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('training_audience_assignment_records.assignment', 'training_audience_assignment_records', 'assignment_id', 'training_audience_assignments', 'training_audience_assignment_records_tenant_assignment_fk', 'training_audience_assignment_records_assignment_id_training_audience_assignments_id_fk', 'cascade'),
  ('training_audience_assignment_records.person', 'training_audience_assignment_records', 'person_id', 'people', 'training_audience_assignment_records_tenant_person_fk', 'training_audience_assignment_records_person_id_people_id_fk', 'cascade'),
  ('training_audience_assignment_targets.assignment', 'training_audience_assignment_targets', 'assignment_id', 'training_audience_assignments', 'training_audience_assignment_targets_tenant_assignment_fk', 'training_audience_assignment_targets_assignment_id_training_audience_assignments_id_fk', 'cascade'),
  ('training_audience_assignment_targets.person', 'training_audience_assignment_targets', 'person_id', 'people', 'training_audience_assignment_targets_tenant_person_fk', 'training_audience_assignment_targets_person_id_people_id_fk', 'cascade'),
  ('training_audience_assignment_targets.trade', 'training_audience_assignment_targets', 'trade_id', 'trades', 'training_audience_assignment_targets_tenant_trade_fk', 'training_audience_assignment_targets_trade_id_trades_id_fk', 'cascade'),
  ('training_audience_assignments.course', 'training_audience_assignments', 'course_id', 'training_courses', 'training_audience_assignments_tenant_course_fk', 'training_audience_assignments_course_id_training_courses_id_fk', 'cascade'),
  ('training_audience_assignments.assessment_type', 'training_audience_assignments', 'assessment_type_id', 'training_assessment_types', 'training_audience_assignments_tenant_assessment_type_fk', 'training_audience_assignments_assessment_type_id_training_assessment_types_id_fk', 'cascade'),
  ('training_audience_assignments.assigned_by', 'training_audience_assignments', 'assigned_by_tenant_user_id', 'tenant_users', 'training_audience_assignments_tenant_assigned_by_fk', 'training_audience_assignments_assigned_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('training_course_files.course', 'training_course_files', 'course_id', 'training_courses', 'training_course_files_tenant_course_fk', 'training_course_files_course_id_training_courses_id_fk', 'cascade'),
  ('training_course_modules.course', 'training_course_modules', 'course_id', 'training_courses', 'training_course_modules_tenant_course_fk', 'training_course_modules_course_id_training_courses_id_fk', 'cascade'),
  ('training_enrollments.course', 'training_enrollments', 'course_id', 'training_courses', 'training_enrollments_tenant_course_fk', 'training_enrollments_course_id_training_courses_id_fk', 'cascade'),
  ('training_enrollments.person', 'training_enrollments', 'person_id', 'people', 'training_enrollments_tenant_person_fk', 'training_enrollments_person_id_people_id_fk', 'cascade'),
  ('training_enrollments.assigned_by', 'training_enrollments', 'assigned_by_tenant_user_id', 'tenant_users', 'training_enrollments_tenant_assigned_by_fk', 'training_enrollments_assigned_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('training_enrollments.record', 'training_enrollments', 'record_id', 'training_records', 'training_enrollments_tenant_record_fk', 'training_enrollments_record_id_training_records_id_fk', 'set null'),
  ('training_lesson_progress.enrollment', 'training_lesson_progress', 'enrollment_id', 'training_enrollments', 'training_lesson_progress_tenant_enrollment_fk', 'training_lesson_progress_enrollment_id_training_enrollments_id_fk', 'cascade'),
  ('training_lesson_progress.lesson', 'training_lesson_progress', 'lesson_id', 'training_lessons', 'training_lesson_progress_tenant_lesson_fk', 'training_lesson_progress_lesson_id_training_lessons_id_fk', 'cascade'),
  ('training_lesson_progress.person', 'training_lesson_progress', 'person_id', 'people', 'training_lesson_progress_tenant_person_fk', 'training_lesson_progress_person_id_people_id_fk', 'cascade'),
  ('training_lesson_progress.assessment', 'training_lesson_progress', 'assessment_id', 'training_assessments', 'training_lesson_progress_tenant_assessment_fk', 'training_lesson_progress_assessment_id_training_assessments_id_fk', 'set null'),
  ('training_lesson_progress.evaluated_by', 'training_lesson_progress', 'evaluated_by_tenant_user_id', 'tenant_users', 'training_lesson_progress_tenant_evaluated_by_fk', 'training_lesson_progress_evaluated_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('training_lessons.course', 'training_lessons', 'course_id', 'training_courses', 'training_lessons_tenant_course_fk', 'training_lessons_course_id_training_courses_id_fk', 'cascade'),
  ('training_lessons.module', 'training_lessons', 'module_id', 'training_course_modules', 'training_lessons_tenant_module_fk', 'training_lessons_module_id_training_course_modules_id_fk', 'cascade'),
  ('training_lessons.assessment_type', 'training_lessons', 'assessment_type_id', 'training_assessment_types', 'training_lessons_tenant_assessment_type_fk', 'training_lessons_assessment_type_id_training_assessment_types_id_fk', 'set null'),
  ('training_lessons.class', 'training_lessons', 'class_id', 'training_classes', 'training_lessons_tenant_class_fk', 'training_lessons_class_id_training_classes_id_fk', 'set null');--> statement-breakpoint

-- The migration owner is NOBYPASSRLS. Transactionally relax FORCE so its
-- preflight sees every tenant while RLS remains enabled for other roles.
ALTER TABLE "tenant_users" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_units" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trades" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_certificates" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_class_attendees" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_classes" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_courses" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_records" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_skill_assignment_files" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_skill_assignments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_skill_certificates" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_skill_types" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_skill_authorities" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_assessment_results" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_assessment_type_questions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_assessment_types" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_assessments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_audience_assignment_records" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_audience_assignment_targets" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_audience_assignments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_course_files" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_course_modules" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_enrollments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_lesson_progress" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_lessons" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DO $$
DECLARE
  relationship record;
  violation_count bigint;
  violations text[] := ARRAY[]::text[];
BEGIN
  FOR relationship IN
    SELECT * FROM "training_relationship_hardening" ORDER BY "ordinal"
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I child LEFT JOIN %I parent ON parent.%I = child.%I WHERE child.%I IS NOT NULL AND (parent.%I IS NULL OR child.%I IS DISTINCT FROM parent.%I)',
      relationship."child_table", relationship."parent_table", 'id',
      relationship."child_column", relationship."child_column", 'id',
      'tenant_id', 'tenant_id'
    ) INTO violation_count;

    IF violation_count > 0 THEN
      violations := array_append(
        violations,
        format('%s=%s', relationship."relation_name", violation_count)
      );
    END IF;
  END LOOP;

  IF cardinality(violations) > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'Training tenant/relation integrity preflight failed: %s',
        array_to_string(violations, ', ')
      );
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "tenant_users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trades" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_certificates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_class_attendees" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_classes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_courses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_skill_assignment_files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_skill_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_skill_certificates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_skill_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_skill_authorities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_assessment_results" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_assessment_type_questions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_assessment_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_assessments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_audience_assignment_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_audience_assignment_targets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_audience_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_course_files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_course_modules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_enrollments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_lesson_progress" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_lessons" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Composite parents must exist before the replacement keys are created.
CREATE UNIQUE INDEX "trades_tenant_id_id_ux" ON "trades" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_classes_tenant_id_id_ux" ON "training_classes" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_courses_tenant_id_id_ux" ON "training_courses" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_records_tenant_id_id_ux" ON "training_records" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_skill_assignments_tenant_id_id_ux" ON "training_skill_assignments" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_skill_authorities_tenant_id_id_ux" ON "training_skill_authorities" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_skill_types_tenant_id_id_ux" ON "training_skill_types" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_assessment_type_questions_tenant_id_id_ux" ON "training_assessment_type_questions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_assessment_types_tenant_id_id_ux" ON "training_assessment_types" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_assessments_tenant_id_id_ux" ON "training_assessments" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_audience_assignments_tenant_id_id_ux" ON "training_audience_assignments" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_course_modules_tenant_id_id_ux" ON "training_course_modules" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_enrollments_tenant_id_id_ux" ON "training_enrollments" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_lessons_tenant_id_id_ux" ON "training_lessons" USING btree ("tenant_id","id");--> statement-breakpoint

DROP INDEX "training_certificates_record_id_ux";--> statement-breakpoint
DROP INDEX "training_class_attendees_class_idx";--> statement-breakpoint
DROP INDEX "training_classes_course_idx";--> statement-breakpoint
DROP INDEX "training_skill_assignment_files_assignment_idx";--> statement-breakpoint
DROP INDEX "training_skill_assignments_skill_type_idx";--> statement-breakpoint
DROP INDEX "training_skill_certificates_skill_assignment_id_ux";--> statement-breakpoint
DROP INDEX "training_skill_types_authority_idx";--> statement-breakpoint
DROP INDEX "training_assessment_results_assessment_idx";--> statement-breakpoint
DROP INDEX "training_assessment_results_question_idx";--> statement-breakpoint
DROP INDEX "training_assessment_type_questions_type_idx";--> statement-breakpoint
DROP INDEX "training_assessment_types_course_idx";--> statement-breakpoint
DROP INDEX "training_assessments_type_idx";--> statement-breakpoint
DROP INDEX "training_audience_assignment_records_assignment_idx";--> statement-breakpoint
DROP INDEX "training_audience_assignment_records_uq";--> statement-breakpoint
DROP INDEX "training_audience_assignment_targets_assignment_idx";--> statement-breakpoint
DROP INDEX "training_audience_assignments_course_idx";--> statement-breakpoint
DROP INDEX "training_audience_assignments_type_idx";--> statement-breakpoint
DROP INDEX "training_course_files_course_idx";--> statement-breakpoint
DROP INDEX "training_course_modules_course_idx";--> statement-breakpoint
DROP INDEX "training_enrollments_person_course_ux";--> statement-breakpoint
DROP INDEX "training_lesson_progress_enrollment_idx";--> statement-breakpoint
DROP INDEX "training_lesson_progress_lesson_ux";--> statement-breakpoint
DROP INDEX "training_lessons_course_idx";--> statement-breakpoint
DROP INDEX "training_lessons_module_idx";--> statement-breakpoint

CREATE UNIQUE INDEX "training_certificates_record_id_ux" ON "training_certificates" USING btree ("tenant_id","record_id");--> statement-breakpoint
CREATE INDEX "training_class_attendees_class_idx" ON "training_class_attendees" USING btree ("tenant_id","class_id");--> statement-breakpoint
CREATE INDEX "training_classes_course_idx" ON "training_classes" USING btree ("tenant_id","course_id");--> statement-breakpoint
CREATE INDEX "training_classes_site_idx" ON "training_classes" USING btree ("tenant_id","site_org_unit_id");--> statement-breakpoint
CREATE INDEX "training_classes_instructor_idx" ON "training_classes" USING btree ("tenant_id","instructor_tenant_user_id");--> statement-breakpoint
CREATE INDEX "training_records_course_idx" ON "training_records" USING btree ("tenant_id","course_id");--> statement-breakpoint
CREATE INDEX "training_records_class_idx" ON "training_records" USING btree ("tenant_id","class_id");--> statement-breakpoint
CREATE INDEX "training_records_evaluator_idx" ON "training_records" USING btree ("tenant_id","evaluator_person_id");--> statement-breakpoint
CREATE INDEX "training_records_issued_by_idx" ON "training_records" USING btree ("tenant_id","issued_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "training_skill_assignment_files_assignment_idx" ON "training_skill_assignment_files" USING btree ("tenant_id","skill_assignment_id");--> statement-breakpoint
CREATE INDEX "training_skill_assignments_skill_type_idx" ON "training_skill_assignments" USING btree ("tenant_id","skill_type_id");--> statement-breakpoint
CREATE INDEX "training_skill_assignments_granted_by_idx" ON "training_skill_assignments" USING btree ("tenant_id","granted_by_tenant_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_skill_certificates_skill_assignment_id_ux" ON "training_skill_certificates" USING btree ("tenant_id","skill_assignment_id");--> statement-breakpoint
CREATE INDEX "training_skill_types_authority_idx" ON "training_skill_types" USING btree ("tenant_id","authority_id");--> statement-breakpoint
CREATE INDEX "training_assessment_results_assessment_idx" ON "training_assessment_results" USING btree ("tenant_id","assessment_id");--> statement-breakpoint
CREATE INDEX "training_assessment_results_question_idx" ON "training_assessment_results" USING btree ("tenant_id","question_id");--> statement-breakpoint
CREATE INDEX "training_assessment_type_questions_type_idx" ON "training_assessment_type_questions" USING btree ("tenant_id","type_id","entity_order");--> statement-breakpoint
CREATE INDEX "training_assessment_types_course_idx" ON "training_assessment_types" USING btree ("tenant_id","course_id");--> statement-breakpoint
CREATE INDEX "training_assessment_types_created_by_idx" ON "training_assessment_types" USING btree ("tenant_id","created_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "training_assessments_type_idx" ON "training_assessments" USING btree ("tenant_id","type_id");--> statement-breakpoint
CREATE INDEX "training_assessments_course_idx" ON "training_assessments" USING btree ("tenant_id","course_id");--> statement-breakpoint
CREATE INDEX "training_assessments_submitted_by_idx" ON "training_assessments" USING btree ("tenant_id","submitted_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "training_audience_assignment_records_assignment_idx" ON "training_audience_assignment_records" USING btree ("tenant_id","assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_audience_assignment_records_uq" ON "training_audience_assignment_records" USING btree ("tenant_id","assignment_id","person_id");--> statement-breakpoint
CREATE INDEX "training_audience_assignment_targets_assignment_idx" ON "training_audience_assignment_targets" USING btree ("tenant_id","assignment_id");--> statement-breakpoint
CREATE INDEX "training_audience_assignment_targets_person_idx" ON "training_audience_assignment_targets" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "training_audience_assignment_targets_trade_idx" ON "training_audience_assignment_targets" USING btree ("tenant_id","trade_id");--> statement-breakpoint
CREATE INDEX "training_audience_assignments_course_idx" ON "training_audience_assignments" USING btree ("tenant_id","course_id");--> statement-breakpoint
CREATE INDEX "training_audience_assignments_type_idx" ON "training_audience_assignments" USING btree ("tenant_id","assessment_type_id");--> statement-breakpoint
CREATE INDEX "training_audience_assignments_assigned_by_idx" ON "training_audience_assignments" USING btree ("tenant_id","assigned_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "training_course_files_course_idx" ON "training_course_files" USING btree ("tenant_id","course_id");--> statement-breakpoint
CREATE INDEX "training_course_modules_course_idx" ON "training_course_modules" USING btree ("tenant_id","course_id","sort_order");--> statement-breakpoint
CREATE INDEX "training_enrollments_assigned_by_idx" ON "training_enrollments" USING btree ("tenant_id","assigned_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "training_enrollments_record_idx" ON "training_enrollments" USING btree ("tenant_id","record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_enrollments_person_course_ux" ON "training_enrollments" USING btree ("tenant_id","course_id","person_id");--> statement-breakpoint
CREATE INDEX "training_lesson_progress_enrollment_idx" ON "training_lesson_progress" USING btree ("tenant_id","enrollment_id");--> statement-breakpoint
CREATE INDEX "training_lesson_progress_lesson_idx" ON "training_lesson_progress" USING btree ("tenant_id","lesson_id");--> statement-breakpoint
CREATE INDEX "training_lesson_progress_assessment_idx" ON "training_lesson_progress" USING btree ("tenant_id","assessment_id");--> statement-breakpoint
CREATE INDEX "training_lesson_progress_evaluated_by_idx" ON "training_lesson_progress" USING btree ("tenant_id","evaluated_by_tenant_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_lesson_progress_lesson_ux" ON "training_lesson_progress" USING btree ("tenant_id","enrollment_id","lesson_id");--> statement-breakpoint
CREATE INDEX "training_lessons_course_idx" ON "training_lessons" USING btree ("tenant_id","course_id");--> statement-breakpoint
CREATE INDEX "training_lessons_module_idx" ON "training_lessons" USING btree ("tenant_id","module_id","sort_order");--> statement-breakpoint
CREATE INDEX "training_lessons_assessment_type_idx" ON "training_lessons" USING btree ("tenant_id","assessment_type_id");--> statement-breakpoint
CREATE INDEX "training_lessons_class_idx" ON "training_lessons" USING btree ("tenant_id","class_id");--> statement-breakpoint

DO $$
DECLARE
  relationship record;
  delete_sql text;
BEGIN
  FOR relationship IN
    SELECT * FROM "training_relationship_hardening" ORDER BY "ordinal"
  LOOP
    delete_sql := CASE relationship."delete_action"
      WHEN 'set null' THEN format('SET NULL (%I)', relationship."child_column")
      WHEN 'cascade' THEN 'CASCADE'
      WHEN 'restrict' THEN 'RESTRICT'
      ELSE 'NO ACTION'
    END;
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I, %I) REFERENCES public.%I (%I, %I) ON DELETE %s ON UPDATE NO ACTION NOT VALID',
      relationship."child_table", relationship."constraint_name", 'tenant_id',
      relationship."child_column", relationship."parent_table", 'tenant_id',
      'id', delete_sql
    );
  END LOOP;
END $$;--> statement-breakpoint

DO $$
DECLARE
  relationship record;
BEGIN
  FOR relationship IN
    SELECT * FROM "training_relationship_hardening" ORDER BY "ordinal"
  LOOP
    EXECUTE format(
      'ALTER TABLE %I VALIDATE CONSTRAINT %I',
      relationship."child_table", relationship."constraint_name"
    );
  END LOOP;
END $$;--> statement-breakpoint

-- Keep the legacy key until its tenant-qualified replacement has validated.
DO $$
DECLARE
  relationship record;
BEGIN
  FOR relationship IN
    SELECT * FROM "training_relationship_hardening" ORDER BY "ordinal"
  LOOP
    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT %I',
      relationship."child_table", left(relationship."legacy_constraint", 63)
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- Squashed source: packages/db/drizzle/0016_awesome_saracen.sql
-- Inspection configuration, schedules, and completed records are tenant-owned
-- end to end. Replace all 19 legacy existence-only foreign keys with
-- tenant-qualified keys while preserving each relationship's established
-- delete behavior. The manifest drives every migration phase so preflight,
-- creation, validation, and retirement cannot drift apart.
CREATE TEMP TABLE "inspection_relationship_hardening" (
  "ordinal" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "relation_name" text NOT NULL,
  "child_table" text NOT NULL,
  "child_column" text NOT NULL,
  "parent_table" text NOT NULL,
  "constraint_name" text NOT NULL,
  "legacy_constraint" text NOT NULL,
  "delete_action" text NOT NULL CHECK (
    "delete_action" IN ('cascade', 'no action', 'set null')
  )
) ON COMMIT DROP;--> statement-breakpoint

INSERT INTO "inspection_relationship_hardening" (
  "relation_name", "child_table", "child_column", "parent_table",
  "constraint_name", "legacy_constraint", "delete_action"
) VALUES
  ('inspection_assignments.type', 'inspection_assignments', 'type_id', 'inspection_types', 'inspection_assignments_tenant_type_fk', 'inspection_assignments_type_id_inspection_types_id_fk', 'cascade'),
  ('inspection_bank_criteria.bank', 'inspection_bank_criteria', 'bank_id', 'inspection_banks', 'inspection_bank_criteria_tenant_bank_fk', 'inspection_bank_criteria_bank_id_inspection_banks_id_fk', 'cascade'),
  ('inspection_record_attachments.record', 'inspection_record_attachments', 'record_id', 'inspection_records', 'inspection_record_attachments_tenant_record_fk', 'inspection_record_attachments_record_id_inspection_records_id_fk', 'cascade'),
  ('inspection_record_criteria.record', 'inspection_record_criteria', 'record_id', 'inspection_records', 'inspection_record_criteria_tenant_record_fk', 'inspection_record_criteria_record_id_inspection_records_id_fk', 'cascade'),
  ('inspection_record_criteria.answered_by', 'inspection_record_criteria', 'answered_by_tenant_user_id', 'tenant_users', 'inspection_record_criteria_tenant_answered_by_fk', 'inspection_record_criteria_answered_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('inspection_record_criteria.assigned_person', 'inspection_record_criteria', 'assigned_to_person_id', 'people', 'inspection_record_criteria_tenant_assigned_person_fk', 'inspection_record_criteria_assigned_to_person_id_people_id_fk', 'set null'),
  ('inspection_record_criteria.assigned_user', 'inspection_record_criteria', 'assigned_to_tenant_user_id', 'tenant_users', 'inspection_record_criteria_tenant_assigned_user_fk', 'inspection_record_criteria_assigned_to_tenant_user_id_tenant_users_id_fk', 'set null'),
  ('inspection_record_criteria.corrective_action', 'inspection_record_criteria', 'corrective_action_id', 'corrective_actions', 'inspection_record_criteria_tenant_corrective_action_fk', 'inspection_record_criteria_corrective_action_id_corrective_actions_id_fk', 'set null'),
  ('inspection_records.type', 'inspection_records', 'type_id', 'inspection_types', 'inspection_records_tenant_type_fk', 'inspection_records_type_id_inspection_types_id_fk', 'no action'),
  ('inspection_records.site', 'inspection_records', 'site_org_unit_id', 'org_units', 'inspection_records_tenant_site_fk', 'inspection_records_site_org_unit_id_org_units_id_fk', 'no action'),
  ('inspection_records.inspector', 'inspection_records', 'inspector_tenant_user_id', 'tenant_users', 'inspection_records_tenant_inspector_fk', 'inspection_records_inspector_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('inspection_records.supervisor', 'inspection_records', 'supervisor_tenant_user_id', 'tenant_users', 'inspection_records_tenant_supervisor_fk', 'inspection_records_supervisor_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('inspection_records.customer_org', 'inspection_records', 'customer_org_unit_id', 'org_units', 'inspection_records_tenant_customer_org_fk', 'inspection_records_customer_org_unit_id_org_units_id_fk', 'no action'),
  ('inspection_records.customer_contact', 'inspection_records', 'customer_contact_person_id', 'people', 'inspection_records_tenant_customer_contact_fk', 'inspection_records_customer_contact_person_id_people_id_fk', 'no action'),
  ('inspection_records.submitted_by', 'inspection_records', 'submitted_by_tenant_user_id', 'tenant_users', 'inspection_records_tenant_submitted_by_fk', 'inspection_records_submitted_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('inspection_records.closed_by', 'inspection_records', 'closed_by_tenant_user_id', 'tenant_users', 'inspection_records_tenant_closed_by_fk', 'inspection_records_closed_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('inspection_type_criteria.type', 'inspection_type_criteria', 'type_id', 'inspection_types', 'inspection_type_criteria_tenant_type_fk', 'inspection_type_criteria_type_id_inspection_types_id_fk', 'cascade'),
  ('inspection_type_criteria.group', 'inspection_type_criteria', 'group_id', 'inspection_type_groups', 'inspection_type_criteria_tenant_group_fk', 'inspection_type_criteria_group_id_inspection_type_groups_id_fk', 'set null'),
  ('inspection_type_groups.type', 'inspection_type_groups', 'type_id', 'inspection_types', 'inspection_type_groups_tenant_type_fk', 'inspection_type_groups_type_id_inspection_types_id_fk', 'cascade');--> statement-breakpoint

-- The migration owner is NOBYPASSRLS. Transactionally relax FORCE so its
-- preflight sees every tenant while RLS remains enabled for other roles.
ALTER TABLE "tenant_users" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_units" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "corrective_actions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_types" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_assignments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_banks" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_bank_criteria" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_records" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_record_attachments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_record_criteria" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_type_groups" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_type_criteria" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DO $$
DECLARE
  relationship record;
  violation_count bigint;
  violations text[] := ARRAY[]::text[];
BEGIN
  FOR relationship IN
    SELECT * FROM "inspection_relationship_hardening" ORDER BY "ordinal"
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I child LEFT JOIN %I parent ON parent.%I = child.%I WHERE child.%I IS NOT NULL AND (parent.%I IS NULL OR child.%I IS DISTINCT FROM parent.%I)',
      relationship."child_table", relationship."parent_table", 'id',
      relationship."child_column", relationship."child_column", 'id',
      'tenant_id', 'tenant_id'
    ) INTO violation_count;

    IF violation_count > 0 THEN
      violations := array_append(
        violations,
        format('%s=%s', relationship."relation_name", violation_count)
      );
    END IF;
  END LOOP;

  IF cardinality(violations) > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'Inspection tenant/relation integrity preflight failed: %s',
        array_to_string(violations, ', ')
      );
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "tenant_users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "corrective_actions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_banks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_bank_criteria" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_record_attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_record_criteria" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_type_groups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_type_criteria" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Composite parents must exist before the replacement keys are created.
CREATE UNIQUE INDEX "corrective_actions_tenant_id_id_ux" ON "corrective_actions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_banks_tenant_id_id_ux" ON "inspection_banks" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_types_tenant_id_id_ux" ON "inspection_types" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_type_groups_tenant_id_id_ux" ON "inspection_type_groups" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_records_tenant_id_id_ux" ON "inspection_records" USING btree ("tenant_id","id");--> statement-breakpoint

DROP INDEX "inspection_bank_criteria_bank_seq_idx";--> statement-breakpoint
DROP INDEX "inspection_type_criteria_type_group_seq_idx";--> statement-breakpoint
DROP INDEX "inspection_type_groups_type_seq_idx";--> statement-breakpoint
DROP INDEX "inspection_record_attachments_record_idx";--> statement-breakpoint
DROP INDEX "inspection_record_criteria_record_idx";--> statement-breakpoint
DROP INDEX "inspection_record_criteria_corrective_idx";--> statement-breakpoint
DROP INDEX "inspection_record_criteria_record_criterion_ux";--> statement-breakpoint

CREATE INDEX "inspection_type_criteria_group_idx" ON "inspection_type_criteria" USING btree ("tenant_id","group_id");--> statement-breakpoint
CREATE INDEX "inspection_records_supervisor_idx" ON "inspection_records" USING btree ("tenant_id","supervisor_tenant_user_id");--> statement-breakpoint
CREATE INDEX "inspection_records_customer_org_idx" ON "inspection_records" USING btree ("tenant_id","customer_org_unit_id");--> statement-breakpoint
CREATE INDEX "inspection_records_customer_contact_idx" ON "inspection_records" USING btree ("tenant_id","customer_contact_person_id");--> statement-breakpoint
CREATE INDEX "inspection_records_submitted_by_idx" ON "inspection_records" USING btree ("tenant_id","submitted_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "inspection_records_closed_by_idx" ON "inspection_records" USING btree ("tenant_id","closed_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "inspection_record_criteria_answered_by_idx" ON "inspection_record_criteria" USING btree ("tenant_id","answered_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "inspection_record_criteria_assigned_person_idx" ON "inspection_record_criteria" USING btree ("tenant_id","assigned_to_person_id");--> statement-breakpoint
CREATE INDEX "inspection_record_criteria_assigned_user_idx" ON "inspection_record_criteria" USING btree ("tenant_id","assigned_to_tenant_user_id");--> statement-breakpoint
CREATE INDEX "inspection_bank_criteria_bank_seq_idx" ON "inspection_bank_criteria" USING btree ("tenant_id","bank_id","sequence");--> statement-breakpoint
CREATE INDEX "inspection_type_criteria_type_group_seq_idx" ON "inspection_type_criteria" USING btree ("tenant_id","type_id","group_id","sequence");--> statement-breakpoint
CREATE INDEX "inspection_type_groups_type_seq_idx" ON "inspection_type_groups" USING btree ("tenant_id","type_id","sequence");--> statement-breakpoint
CREATE INDEX "inspection_record_attachments_record_idx" ON "inspection_record_attachments" USING btree ("tenant_id","record_id");--> statement-breakpoint
CREATE INDEX "inspection_record_criteria_record_idx" ON "inspection_record_criteria" USING btree ("tenant_id","record_id","sequence");--> statement-breakpoint
CREATE INDEX "inspection_record_criteria_corrective_idx" ON "inspection_record_criteria" USING btree ("tenant_id","corrective_action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_record_criteria_record_criterion_ux" ON "inspection_record_criteria" USING btree ("tenant_id","record_id","criterion_id");--> statement-breakpoint

DO $$
DECLARE
  relationship record;
  delete_sql text;
BEGIN
  FOR relationship IN
    SELECT * FROM "inspection_relationship_hardening" ORDER BY "ordinal"
  LOOP
    delete_sql := CASE relationship."delete_action"
      WHEN 'set null' THEN format('SET NULL (%I)', relationship."child_column")
      WHEN 'cascade' THEN 'CASCADE'
      ELSE 'NO ACTION'
    END;
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I, %I) REFERENCES public.%I (%I, %I) ON DELETE %s ON UPDATE NO ACTION NOT VALID',
      relationship."child_table", relationship."constraint_name", 'tenant_id',
      relationship."child_column", relationship."parent_table", 'tenant_id',
      'id', delete_sql
    );
  END LOOP;
END $$;--> statement-breakpoint

DO $$
DECLARE
  relationship record;
BEGIN
  FOR relationship IN
    SELECT * FROM "inspection_relationship_hardening" ORDER BY "ordinal"
  LOOP
    EXECUTE format(
      'ALTER TABLE %I VALIDATE CONSTRAINT %I',
      relationship."child_table", relationship."constraint_name"
    );
  END LOOP;
END $$;--> statement-breakpoint

-- Keep every legacy key until its tenant-qualified replacement has validated.
DO $$
DECLARE
  relationship record;
BEGIN
  FOR relationship IN
    SELECT * FROM "inspection_relationship_hardening" ORDER BY "ordinal"
  LOOP
    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT %I',
      relationship."child_table", left(relationship."legacy_constraint", 63)
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- Squashed source: packages/db/drizzle/0017_nosy_stone_men.sql
-- People, org hierarchy, workforce taxonomies, contacts, kiosks, groups,
-- titles, files, and acknowledgments are tenant-owned end to end. Replace all
-- 19 legacy existence-only foreign keys with tenant-qualified keys while
-- preserving established delete behavior. The manifest drives every cutover
-- phase so preflight, creation, validation, and retirement cannot drift.
CREATE TEMP TABLE "people_org_relationship_hardening" (
  "ordinal" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "relation_name" text NOT NULL,
  "child_table" text NOT NULL,
  "child_column" text NOT NULL,
  "parent_table" text NOT NULL,
  "constraint_name" text NOT NULL,
  "legacy_constraint" text NOT NULL,
  "delete_action" text NOT NULL CHECK (
    "delete_action" IN ('cascade', 'no action', 'set null')
  )
) ON COMMIT DROP;--> statement-breakpoint

INSERT INTO "people_org_relationship_hardening" (
  "relation_name", "child_table", "child_column", "parent_table",
  "constraint_name", "legacy_constraint", "delete_action"
) VALUES
  ('customer_contacts.org_unit', 'customer_contacts', 'org_unit_id', 'org_units', 'customer_contacts_tenant_org_unit_fk', 'customer_contacts_org_unit_id_org_units_id_fk', 'cascade'),
  ('job_title_task_acknowledgments.person', 'job_title_task_acknowledgments', 'person_id', 'people', 'job_title_task_acks_tenant_person_fk', 'job_title_task_acknowledgments_person_id_people_id_fk', 'cascade'),
  ('job_title_task_acknowledgments.task', 'job_title_task_acknowledgments', 'task_id', 'job_title_tasks', 'job_title_task_acks_tenant_task_fk', 'job_title_task_acknowledgments_task_id_job_title_tasks_id_fk', 'cascade'),
  ('job_title_tasks.title', 'job_title_tasks', 'title_id', 'person_titles', 'job_title_tasks_tenant_title_fk', 'job_title_tasks_title_id_person_titles_id_fk', 'cascade'),
  ('kiosk_scans.crew', 'kiosk_scans', 'crew_id', 'crews', 'kiosk_scans_tenant_crew_fk', 'kiosk_scans_crew_id_crews_id_fk', 'no action'),
  ('kiosk_scans.person', 'kiosk_scans', 'person_id', 'people', 'kiosk_scans_tenant_person_fk', 'kiosk_scans_person_id_people_id_fk', 'cascade'),
  ('kiosk_scans.site', 'kiosk_scans', 'site_org_unit_id', 'org_units', 'kiosk_scans_tenant_site_fk', 'kiosk_scans_site_org_unit_id_org_units_id_fk', 'no action'),
  ('org_units.parent', 'org_units', 'parent_id', 'org_units', 'org_units_tenant_parent_fk', 'org_units_parent_id_org_units_id_fk', 'cascade'),
  ('people.crew', 'people', 'crew_id', 'crews', 'people_tenant_crew_fk', 'people_crew_id_crews_id_fk', 'no action'),
  ('people.department', 'people', 'department_id', 'departments', 'people_tenant_department_fk', 'people_department_id_departments_id_fk', 'no action'),
  ('people.manager', 'people', 'manager_person_id', 'people', 'people_tenant_manager_fk', 'people_manager_person_id_people_id_fk', 'set null'),
  ('people.trade', 'people', 'trade_id', 'trades', 'people_tenant_trade_fk', 'people_trade_id_trades_id_fk', 'no action'),
  ('people_assignments.org_unit', 'people_assignments', 'org_unit_id', 'org_units', 'people_assignments_tenant_org_fk', 'people_assignments_org_unit_id_org_units_id_fk', 'cascade'),
  ('people_assignments.person', 'people_assignments', 'person_id', 'people', 'people_assignments_tenant_person_fk', 'people_assignments_person_id_people_id_fk', 'cascade'),
  ('person_files.person', 'person_files', 'person_id', 'people', 'person_files_tenant_person_fk', 'person_files_person_id_people_id_fk', 'cascade'),
  ('person_group_memberships.group', 'person_group_memberships', 'group_id', 'person_groups', 'person_group_memberships_tenant_group_fk', 'person_group_memberships_group_id_person_groups_id_fk', 'cascade'),
  ('person_group_memberships.person', 'person_group_memberships', 'person_id', 'people', 'person_group_memberships_tenant_person_fk', 'person_group_memberships_person_id_people_id_fk', 'cascade'),
  ('person_title_assignments.person', 'person_title_assignments', 'person_id', 'people', 'person_title_assignments_tenant_person_fk', 'person_title_assignments_person_id_people_id_fk', 'cascade'),
  ('person_title_assignments.title', 'person_title_assignments', 'title_id', 'person_titles', 'person_title_assignments_tenant_title_fk', 'person_title_assignments_title_id_person_titles_id_fk', 'cascade');--> statement-breakpoint

-- The migration owner is NOBYPASSRLS. Transactionally relax FORCE so its
-- preflight sees every tenant while RLS remains enabled for other roles.
ALTER TABLE "org_units" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "departments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trades" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crews" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people_assignments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_contacts" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kiosk_scans" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "person_groups" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "person_group_memberships" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "person_titles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "person_title_assignments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "person_files" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_title_tasks" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_title_task_acknowledgments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DO $$
DECLARE
  relationship record;
  violation_count bigint;
  orphan_foreman_count bigint;
  violations text[] := ARRAY[]::text[];
BEGIN
  FOR relationship IN
    SELECT * FROM "people_org_relationship_hardening" ORDER BY "ordinal"
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I child LEFT JOIN %I parent ON parent.%I = child.%I WHERE child.%I IS NOT NULL AND (parent.%I IS NULL OR child.%I IS DISTINCT FROM parent.%I)',
      relationship."child_table", relationship."parent_table", 'id',
      relationship."child_column", relationship."child_column", 'id',
      'tenant_id', 'tenant_id'
    ) INTO violation_count;

    IF violation_count > 0 THEN
      violations := array_append(
        violations,
        format('%s=%s', relationship."relation_name", violation_count)
      );
    END IF;
  END LOOP;

  -- foreman_person_id has no reader, writer, relation, or ETL source. Refuse
  -- to discard an unexpected deployed value even though the local lineage is
  -- empty; operators must investigate it before the clean-cutover removal.
  SELECT count(*) INTO orphan_foreman_count
  FROM "crews"
  WHERE "foreman_person_id" IS NOT NULL;
  IF orphan_foreman_count > 0 THEN
    violations := array_append(
      violations,
      format('crews.foreman_person_id(unused non-null values)=%s', orphan_foreman_count)
    );
  END IF;

  IF cardinality(violations) > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'People/org tenant/relation integrity preflight failed: %s',
        array_to_string(violations, ', ')
      );
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "org_units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "departments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trades" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kiosk_scans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "person_groups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "person_group_memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "person_titles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "person_title_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "person_files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_title_tasks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_title_task_acknowledgments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Composite parents must exist before the replacement keys are created.
CREATE UNIQUE INDEX "crews_tenant_id_id_ux" ON "crews" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_groups_tenant_id_id_ux" ON "person_groups" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_titles_tenant_id_id_ux" ON "person_titles" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_title_tasks_tenant_id_id_ux" ON "job_title_tasks" USING btree ("tenant_id","id");--> statement-breakpoint

DROP INDEX "org_units_parent_idx";--> statement-breakpoint
DROP INDEX "people_assignments_person_idx";--> statement-breakpoint
DROP INDEX "people_assignments_org_idx";--> statement-breakpoint
DROP INDEX "person_group_memberships_group_idx";--> statement-breakpoint
DROP INDEX "person_group_memberships_person_idx";--> statement-breakpoint
DROP INDEX "person_group_memberships_unique_ux";--> statement-breakpoint
DROP INDEX "person_title_assignments_title_idx";--> statement-breakpoint
DROP INDEX "person_title_assignments_person_idx";--> statement-breakpoint
DROP INDEX "person_title_assignments_unique_ux";--> statement-breakpoint
DROP INDEX "person_files_person_idx";--> statement-breakpoint
DROP INDEX "job_title_task_acks_task_idx";--> statement-breakpoint
DROP INDEX "job_title_task_acks_person_idx";--> statement-breakpoint
DROP INDEX "job_title_task_acks_unique_ux";--> statement-breakpoint
DROP INDEX "job_title_tasks_title_idx";--> statement-breakpoint
DROP INDEX "job_title_tasks_order_idx";--> statement-breakpoint

CREATE INDEX "people_department_idx" ON "people" USING btree ("tenant_id","department_id");--> statement-breakpoint
CREATE INDEX "people_trade_idx" ON "people" USING btree ("tenant_id","trade_id");--> statement-breakpoint
CREATE INDEX "people_crew_idx" ON "people" USING btree ("tenant_id","crew_id");--> statement-breakpoint
CREATE INDEX "people_manager_idx" ON "people" USING btree ("tenant_id","manager_person_id");--> statement-breakpoint
CREATE INDEX "kiosk_scans_site_idx" ON "kiosk_scans" USING btree ("tenant_id","site_org_unit_id","scanned_at");--> statement-breakpoint
CREATE INDEX "kiosk_scans_crew_idx" ON "kiosk_scans" USING btree ("tenant_id","crew_id","scanned_at");--> statement-breakpoint
CREATE INDEX "org_units_parent_idx" ON "org_units" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE INDEX "people_assignments_person_idx" ON "people_assignments" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "people_assignments_org_idx" ON "people_assignments" USING btree ("tenant_id","org_unit_id");--> statement-breakpoint
CREATE INDEX "person_group_memberships_group_idx" ON "person_group_memberships" USING btree ("tenant_id","group_id");--> statement-breakpoint
CREATE INDEX "person_group_memberships_person_idx" ON "person_group_memberships" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_group_memberships_unique_ux" ON "person_group_memberships" USING btree ("tenant_id","group_id","person_id");--> statement-breakpoint
CREATE INDEX "person_title_assignments_title_idx" ON "person_title_assignments" USING btree ("tenant_id","title_id");--> statement-breakpoint
CREATE INDEX "person_title_assignments_person_idx" ON "person_title_assignments" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_title_assignments_unique_ux" ON "person_title_assignments" USING btree ("tenant_id","title_id","person_id");--> statement-breakpoint
CREATE INDEX "person_files_person_idx" ON "person_files" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "job_title_task_acks_task_idx" ON "job_title_task_acknowledgments" USING btree ("tenant_id","task_id");--> statement-breakpoint
CREATE INDEX "job_title_task_acks_person_idx" ON "job_title_task_acknowledgments" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_title_task_acks_unique_ux" ON "job_title_task_acknowledgments" USING btree ("tenant_id","task_id","person_id");--> statement-breakpoint
CREATE INDEX "job_title_tasks_title_idx" ON "job_title_tasks" USING btree ("tenant_id","title_id");--> statement-breakpoint
CREATE INDEX "job_title_tasks_order_idx" ON "job_title_tasks" USING btree ("tenant_id","title_id","entity_order");--> statement-breakpoint

DO $$
DECLARE
  relationship record;
  delete_sql text;
BEGIN
  FOR relationship IN
    SELECT * FROM "people_org_relationship_hardening" ORDER BY "ordinal"
  LOOP
    delete_sql := CASE relationship."delete_action"
      WHEN 'set null' THEN format('SET NULL (%I)', relationship."child_column")
      WHEN 'cascade' THEN 'CASCADE'
      ELSE 'NO ACTION'
    END;
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I, %I) REFERENCES public.%I (%I, %I) ON DELETE %s ON UPDATE NO ACTION NOT VALID',
      relationship."child_table", relationship."constraint_name", 'tenant_id',
      relationship."child_column", relationship."parent_table", 'tenant_id',
      'id', delete_sql
    );
  END LOOP;
END $$;--> statement-breakpoint

DO $$
DECLARE
  relationship record;
BEGIN
  FOR relationship IN
    SELECT * FROM "people_org_relationship_hardening" ORDER BY "ordinal"
  LOOP
    EXECUTE format(
      'ALTER TABLE %I VALIDATE CONSTRAINT %I',
      relationship."child_table", relationship."constraint_name"
    );
  END LOOP;
END $$;--> statement-breakpoint

-- Keep every legacy key until its tenant-qualified replacement has validated.
DO $$
DECLARE
  relationship record;
BEGIN
  FOR relationship IN
    SELECT * FROM "people_org_relationship_hardening" ORDER BY "ordinal"
  LOOP
    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT %I',
      relationship."child_table", left(relationship."legacy_constraint", 63)
    );
  END LOOP;
END $$;--> statement-breakpoint

-- No runtime or private ETL path reads or writes this abandoned field, and the
-- preflight above proves no deployed value is silently discarded.
ALTER TABLE "crews" DROP COLUMN "foreman_person_id";
--> statement-breakpoint

-- Squashed source: packages/db/drizzle/0018_organic_madame_web.sql
-- PPE inspections now preserve the immutable checklist evidence used to reach
-- the submitted result. Existing inspections predate draft capture, so they
-- enter as submitted only after the guarded preflight below proves every row
-- already has the result and inspection date required by that state.
CREATE TYPE "public"."ppe_inspection_status" AS ENUM('in_progress', 'submitted');--> statement-breakpoint
ALTER TABLE "ppe_inspections" ADD COLUMN "status" "ppe_inspection_status" DEFAULT 'submitted' NOT NULL;--> statement-breakpoint
ALTER TABLE "ppe_inspections" ADD COLUMN "inspector_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "ppe_issue_reports" ADD COLUMN "inspection_id" uuid;--> statement-breakpoint
ALTER TABLE "ppe_issue_reports" ADD COLUMN "reported_by_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "ppe_issue_reports" ADD COLUMN "source" text;--> statement-breakpoint

CREATE TABLE "ppe_inspection_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"inspection_id" uuid NOT NULL,
	"criterion_id" uuid,
	"question_text_snapshot" text NOT NULL,
	"description_snapshot" text,
	"severity" "ppe_criterion_severity" DEFAULT 'medium' NOT NULL,
	"requires_photo" boolean DEFAULT false NOT NULL,
	"sequence" integer NOT NULL,
	"answer" "ppe_inspection_result",
	"non_compliance_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "ppe_inspection_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"inspection_id" uuid,
	"criterion_result_id" uuid,
	"attachment_id" uuid NOT NULL,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ppe_inspection_attachments_exactly_one_owner_ck" CHECK (
		("inspection_id" IS NULL) <> ("criterion_result_id" IS NULL)
	)
);--> statement-breakpoint

ALTER TABLE "ppe_inspection_criteria" ADD CONSTRAINT "ppe_inspection_criteria_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppe_inspection_attachments" ADD CONSTRAINT "ppe_inspection_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "ppe_inspection_criteria_tenant_idx" ON "ppe_inspection_criteria" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ppe_inspection_criteria_tenant_id_id_ux" ON "ppe_inspection_criteria" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "ppe_inspection_criteria_inspection_idx" ON "ppe_inspection_criteria" USING btree ("tenant_id","inspection_id","sequence");--> statement-breakpoint
CREATE INDEX "ppe_inspection_criteria_answer_idx" ON "ppe_inspection_criteria" USING btree ("tenant_id","answer");--> statement-breakpoint
CREATE UNIQUE INDEX "ppe_inspection_criteria_inspection_criterion_ux" ON "ppe_inspection_criteria" USING btree ("tenant_id","inspection_id","criterion_id");--> statement-breakpoint
CREATE INDEX "ppe_inspection_attachments_tenant_idx" ON "ppe_inspection_attachments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ppe_inspection_attachments_inspection_idx" ON "ppe_inspection_attachments" USING btree ("tenant_id","inspection_id");--> statement-breakpoint
CREATE INDEX "ppe_inspection_attachments_criterion_idx" ON "ppe_inspection_attachments" USING btree ("tenant_id","criterion_result_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ppe_inspection_attachments_inspection_attachment_ux" ON "ppe_inspection_attachments" USING btree ("tenant_id","inspection_id","attachment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ppe_inspection_attachments_criterion_attachment_ux" ON "ppe_inspection_attachments" USING btree ("tenant_id","criterion_result_id","attachment_id");--> statement-breakpoint

-- The policy installer runs immediately after migrations. Enable RLS now; the
-- all-tenant preflight below then converges both tables to FORCE RLS alongside
-- the rest of the PPE domain.
ALTER TABLE "ppe_inspection_criteria" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_inspection_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- PPE inventory, issue, inspection, criteria, and annual-record relationships
-- are tenant-owned end to end. Replace all 15 legacy existence-only foreign
-- keys and install three new checklist-evidence relationships, yielding 18
-- tenant-qualified keys with the established delete behavior preserved.
-- The manifest drives every cutover phase so preflight, creation, validation,
-- and retirement cannot drift.
CREATE TEMP TABLE "ppe_relationship_hardening" (
  "ordinal" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "relation_name" text NOT NULL,
  "child_table" text NOT NULL,
  "child_column" text NOT NULL,
  "parent_table" text NOT NULL,
  "constraint_name" text NOT NULL,
  "legacy_constraint" text NOT NULL,
  "delete_action" text NOT NULL CHECK (
    "delete_action" IN ('cascade', 'no action', 'set null')
  )
) ON COMMIT DROP;--> statement-breakpoint

INSERT INTO "ppe_relationship_hardening" (
  "relation_name", "child_table", "child_column", "parent_table",
  "constraint_name", "legacy_constraint", "delete_action"
) VALUES
  ('ppe_annual_records.inspected_by', 'ppe_annual_records', 'inspected_by_person_id', 'people', 'ppe_annual_records_tenant_inspected_by_fk', 'ppe_annual_records_inspected_by_person_id_people_id_fk', 'no action'),
  ('ppe_annual_records.item', 'ppe_annual_records', 'item_id', 'ppe_items', 'ppe_annual_records_tenant_item_fk', 'ppe_annual_records_item_id_ppe_items_id_fk', 'cascade'),
  ('ppe_criteria_bank_criteria.bank', 'ppe_criteria_bank_criteria', 'bank_id', 'ppe_criteria_banks', 'ppe_criteria_bank_criteria_tenant_bank_fk', 'ppe_criteria_bank_criteria_bank_id_ppe_criteria_banks_id_fk', 'cascade'),
  ('ppe_inspection_attachments.criterion', 'ppe_inspection_attachments', 'criterion_result_id', 'ppe_inspection_criteria', 'ppe_inspection_attachments_tenant_criterion_fk', 'ppe_inspection_attachments_criterion_result_id_ppe_inspection_criteria_id_fk', 'cascade'),
  ('ppe_inspection_attachments.inspection', 'ppe_inspection_attachments', 'inspection_id', 'ppe_inspections', 'ppe_inspection_attachments_tenant_inspection_fk', 'ppe_inspection_attachments_inspection_id_ppe_inspections_id_fk', 'cascade'),
  ('ppe_inspection_criteria.inspection', 'ppe_inspection_criteria', 'inspection_id', 'ppe_inspections', 'ppe_inspection_criteria_tenant_inspection_fk', 'ppe_inspection_criteria_inspection_id_ppe_inspections_id_fk', 'cascade'),
  ('ppe_inspections.inspected_by', 'ppe_inspections', 'inspected_by_tenant_user_id', 'tenant_users', 'ppe_inspections_tenant_inspected_by_fk', 'ppe_inspections_inspected_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('ppe_inspections.item', 'ppe_inspections', 'item_id', 'ppe_items', 'ppe_inspections_tenant_item_fk', 'ppe_inspections_item_id_ppe_items_id_fk', 'cascade'),
  ('ppe_issue_reports.inspection', 'ppe_issue_reports', 'inspection_id', 'ppe_inspections', 'ppe_issue_reports_tenant_inspection_fk', 'ppe_issue_reports_inspection_id_ppe_inspections_id_fk', 'no action'),
  ('ppe_issue_reports.item', 'ppe_issue_reports', 'item_id', 'ppe_items', 'ppe_issue_reports_tenant_item_fk', 'ppe_issue_reports_item_id_ppe_items_id_fk', 'cascade'),
  ('ppe_issue_reports.reported_by', 'ppe_issue_reports', 'reported_by_tenant_user_id', 'tenant_users', 'ppe_issue_reports_tenant_reported_by_fk', 'ppe_issue_reports_reported_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('ppe_issues.issued_by', 'ppe_issues', 'issued_by_tenant_user_id', 'tenant_users', 'ppe_issues_tenant_issued_by_fk', 'ppe_issues_issued_by_tenant_user_id_tenant_users_id_fk', 'no action'),
  ('ppe_issues.item', 'ppe_issues', 'item_id', 'ppe_items', 'ppe_issues_tenant_item_fk', 'ppe_issues_item_id_ppe_items_id_fk', 'cascade'),
  ('ppe_issues.person', 'ppe_issues', 'person_id', 'people', 'ppe_issues_tenant_person_fk', 'ppe_issues_person_id_people_id_fk', 'no action'),
  ('ppe_items.current_holder', 'ppe_items', 'current_holder_person_id', 'people', 'ppe_items_tenant_current_holder_fk', 'ppe_items_current_holder_person_id_people_id_fk', 'no action'),
  ('ppe_items.type', 'ppe_items', 'type_id', 'ppe_types', 'ppe_items_tenant_type_fk', 'ppe_items_type_id_ppe_types_id_fk', 'no action'),
  ('ppe_type_criteria_groups.type', 'ppe_type_criteria_groups', 'ppe_type_id', 'ppe_types', 'ppe_type_criteria_groups_tenant_type_fk', 'ppe_type_criteria_groups_ppe_type_id_ppe_types_id_fk', 'cascade'),
  ('ppe_type_inspection_criteria.group', 'ppe_type_inspection_criteria', 'group_id', 'ppe_type_criteria_groups', 'ppe_type_inspection_criteria_tenant_group_fk', 'ppe_type_inspection_criteria_group_id_ppe_type_criteria_groups_id_fk', 'set null'),
  ('ppe_type_inspection_criteria.type', 'ppe_type_inspection_criteria', 'ppe_type_id', 'ppe_types', 'ppe_type_inspection_criteria_tenant_type_fk', 'ppe_type_inspection_criteria_ppe_type_id_ppe_types_id_fk', 'cascade');--> statement-breakpoint

-- The migration owner is NOBYPASSRLS. Transactionally relax FORCE so its
-- preflight sees every tenant while RLS remains enabled for other roles.
ALTER TABLE "tenant_users" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_types" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_items" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_issues" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_inspections" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_issue_reports" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_criteria_banks" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_criteria_bank_criteria" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_type_criteria_groups" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_type_inspection_criteria" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_annual_records" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_inspection_criteria" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_inspection_attachments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DO $$
DECLARE
  relationship record;
  violation_count bigint;
  violations text[] := ARRAY[]::text[];
BEGIN
  FOR relationship IN
    SELECT * FROM "ppe_relationship_hardening" ORDER BY "ordinal"
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I child LEFT JOIN %I parent ON parent.%I = child.%I WHERE child.%I IS NOT NULL AND (parent.%I IS NULL OR child.%I IS DISTINCT FROM parent.%I)',
      relationship."child_table", relationship."parent_table", 'id',
      relationship."child_column", relationship."child_column", 'id',
      'tenant_id', 'tenant_id'
    ) INTO violation_count;

    IF violation_count > 0 THEN
      violations := array_append(
        violations,
        format('%s=%s', relationship."relation_name", violation_count)
      );
    END IF;
  END LOOP;

  IF cardinality(violations) > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'PPE tenant/relation integrity preflight failed: %s',
        array_to_string(violations, ', ')
      );
  END IF;
END $$;--> statement-breakpoint

-- Preserve the exact display identity available through the existing
-- tenant-qualified actor relationship. Imported or otherwise unmapped actors
-- remain null; migration code must never manufacture evidence attribution.
UPDATE "ppe_inspections" AS inspection
SET "inspector_name_snapshot" = coalesce(member."display_name", account."name")
FROM "tenant_users" AS member
LEFT JOIN "user" AS account
  ON account."id" = member."user_id"
WHERE member."tenant_id" = inspection."tenant_id"
  AND member."id" = inspection."inspected_by_tenant_user_id"
  AND coalesce(member."display_name", account."name") IS NOT NULL;--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*)
  INTO violation_count
  FROM "ppe_inspections" AS inspection
  LEFT JOIN "tenant_users" AS member
    ON member."tenant_id" = inspection."tenant_id"
   AND member."id" = inspection."inspected_by_tenant_user_id"
  LEFT JOIN "user" AS account
    ON account."id" = member."user_id"
  WHERE inspection."inspector_name_snapshot" IS DISTINCT FROM
    CASE
      WHEN member."id" IS NULL THEN NULL
      ELSE coalesce(member."display_name", account."name")
    END;

  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'PPE inspector snapshot verification failed: % row(s) do not match their exact resolved actor identity',
      violation_count;
  END IF;
END $$;--> statement-breakpoint

-- Existing issue reports were created through the manual application flow.
-- Preserve reporter display evidence only when its exact tenant membership
-- resolves, and intentionally leave inspection provenance null rather than
-- guessing from item or timestamp proximity.
UPDATE "ppe_issue_reports" AS report
SET "reported_by_name_snapshot" = coalesce(member."display_name", account."name")
FROM "tenant_users" AS member
LEFT JOIN "user" AS account
  ON account."id" = member."user_id"
WHERE member."tenant_id" = report."tenant_id"
  AND member."id" = report."reported_by_tenant_user_id"
  AND coalesce(member."display_name", account."name") IS NOT NULL;--> statement-breakpoint

UPDATE "ppe_issue_reports"
SET "source" = 'manual'
WHERE "source" IS NULL;--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*)
  INTO violation_count
  FROM "ppe_issue_reports" AS report
  LEFT JOIN "tenant_users" AS member
    ON member."tenant_id" = report."tenant_id"
   AND member."id" = report."reported_by_tenant_user_id"
  LEFT JOIN "user" AS account
    ON account."id" = member."user_id"
  WHERE report."reported_by_name_snapshot" IS DISTINCT FROM
    CASE
      WHEN member."id" IS NULL THEN NULL
      ELSE coalesce(member."display_name", account."name")
    END;

  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'PPE issue reporter snapshot verification failed: % row(s) do not match their exact resolved actor identity',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "ppe_issue_reports"
  WHERE "source" IS DISTINCT FROM 'manual'
     OR "inspection_id" IS NOT NULL;

  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'PPE issue provenance verification failed: % historical row(s) have a non-manual source or guessed inspection link',
      violation_count;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "ppe_issue_reports"
  ALTER COLUMN "source" SET DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE "ppe_issue_reports"
  ALTER COLUMN "source" SET NOT NULL;--> statement-breakpoint

DO $$
DECLARE
  invalid_count bigint;
BEGIN
  SELECT count(*)
  INTO invalid_count
  FROM "ppe_inspections"
  WHERE "result" IS NULL
     OR "inspected_on" IS NULL;

  IF invalid_count > 0 THEN
    RAISE EXCEPTION
      'PPE inspection status preflight failed: % historical row(s) lack a submitted result or inspection date',
      invalid_count;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "ppe_inspections" ALTER COLUMN "result" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ppe_inspections" ALTER COLUMN "inspected_on" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ppe_inspections" ADD CONSTRAINT "ppe_inspections_submitted_result_ck" CHECK (
  "status" <> 'submitted' OR ("result" IS NOT NULL AND "inspected_on" IS NOT NULL)
) NOT VALID;--> statement-breakpoint
ALTER TABLE "ppe_inspections" VALIDATE CONSTRAINT "ppe_inspections_submitted_result_ck";--> statement-breakpoint

CREATE POLICY "tenant_isolation" ON "ppe_inspection_criteria"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ppe_inspection_attachments"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "tenant_users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_issues" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_inspections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_issue_reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_criteria_banks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_criteria_bank_criteria" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_type_criteria_groups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_type_inspection_criteria" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_annual_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_inspection_criteria" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ppe_inspection_attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Composite parents must exist before the replacement keys are created.
CREATE UNIQUE INDEX "ppe_types_tenant_id_id_ux" ON "ppe_types" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ppe_items_tenant_id_id_ux" ON "ppe_items" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ppe_criteria_banks_tenant_id_id_ux" ON "ppe_criteria_banks" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ppe_type_criteria_groups_tenant_id_id_ux" ON "ppe_type_criteria_groups" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ppe_inspections_tenant_id_id_ux" ON "ppe_inspections" USING btree ("tenant_id","id");--> statement-breakpoint

DROP INDEX "ppe_inspections_item_idx";--> statement-breakpoint
DROP INDEX "ppe_issue_reports_item_idx";--> statement-breakpoint
DROP INDEX "ppe_issues_item_idx";--> statement-breakpoint
DROP INDEX "ppe_items_type_idx";--> statement-breakpoint
DROP INDEX "ppe_type_criteria_groups_type_idx";--> statement-breakpoint
DROP INDEX "ppe_type_inspection_criteria_type_idx";--> statement-breakpoint
DROP INDEX "ppe_type_inspection_criteria_group_idx";--> statement-breakpoint
DROP INDEX "ppe_criteria_bank_criteria_bank_seq_idx";--> statement-breakpoint
DROP INDEX "ppe_annual_records_item_idx";--> statement-breakpoint
DROP INDEX "ppe_annual_records_item_year_ux";--> statement-breakpoint

CREATE INDEX "ppe_inspections_inspected_by_idx" ON "ppe_inspections" USING btree ("tenant_id","inspected_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "ppe_issue_reports_reported_by_idx" ON "ppe_issue_reports" USING btree ("tenant_id","reported_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "ppe_issue_reports_inspection_idx" ON "ppe_issue_reports" USING btree ("tenant_id","inspection_id");--> statement-breakpoint
CREATE INDEX "ppe_issues_issued_by_idx" ON "ppe_issues" USING btree ("tenant_id","issued_by_tenant_user_id");--> statement-breakpoint
CREATE INDEX "ppe_annual_records_inspected_by_idx" ON "ppe_annual_records" USING btree ("tenant_id","inspected_by_person_id");--> statement-breakpoint
CREATE INDEX "ppe_inspections_item_idx" ON "ppe_inspections" USING btree ("tenant_id","item_id","inspected_on");--> statement-breakpoint
CREATE INDEX "ppe_issue_reports_item_idx" ON "ppe_issue_reports" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "ppe_issues_item_idx" ON "ppe_issues" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "ppe_items_type_idx" ON "ppe_items" USING btree ("tenant_id","type_id");--> statement-breakpoint
CREATE INDEX "ppe_type_criteria_groups_type_idx" ON "ppe_type_criteria_groups" USING btree ("tenant_id","ppe_type_id","inspection_kind","sequence");--> statement-breakpoint
CREATE INDEX "ppe_type_inspection_criteria_type_idx" ON "ppe_type_inspection_criteria" USING btree ("tenant_id","ppe_type_id","inspection_kind","entity_order");--> statement-breakpoint
CREATE INDEX "ppe_type_inspection_criteria_group_idx" ON "ppe_type_inspection_criteria" USING btree ("tenant_id","group_id");--> statement-breakpoint
CREATE INDEX "ppe_criteria_bank_criteria_bank_seq_idx" ON "ppe_criteria_bank_criteria" USING btree ("tenant_id","bank_id","sequence");--> statement-breakpoint
CREATE INDEX "ppe_annual_records_item_idx" ON "ppe_annual_records" USING btree ("tenant_id","item_id","inspected_on");--> statement-breakpoint
CREATE UNIQUE INDEX "ppe_annual_records_item_year_ux" ON "ppe_annual_records" USING btree ("tenant_id","item_id","year");--> statement-breakpoint

DO $$
DECLARE
  relationship record;
  delete_sql text;
BEGIN
  FOR relationship IN
    SELECT * FROM "ppe_relationship_hardening" ORDER BY "ordinal"
  LOOP
    delete_sql := CASE relationship."delete_action"
      WHEN 'set null' THEN format('SET NULL (%I)', relationship."child_column")
      WHEN 'cascade' THEN 'CASCADE'
      ELSE 'NO ACTION'
    END;
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I, %I) REFERENCES public.%I (%I, %I) ON DELETE %s ON UPDATE NO ACTION NOT VALID',
      relationship."child_table", relationship."constraint_name", 'tenant_id',
      relationship."child_column", relationship."parent_table", 'tenant_id',
      'id', delete_sql
    );
  END LOOP;
END $$;--> statement-breakpoint

DO $$
DECLARE
  relationship record;
BEGIN
  FOR relationship IN
    SELECT * FROM "ppe_relationship_hardening" ORDER BY "ordinal"
  LOOP
    EXECUTE format(
      'ALTER TABLE %I VALIDATE CONSTRAINT %I',
      relationship."child_table", relationship."constraint_name"
    );
  END LOOP;
END $$;--> statement-breakpoint

-- Keep every legacy key until its tenant-qualified replacement has validated.
DO $$
DECLARE
  relationship record;
BEGIN
  FOR relationship IN
    SELECT * FROM "ppe_relationship_hardening" ORDER BY "ordinal"
  LOOP
    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
      relationship."child_table", left(relationship."legacy_constraint", 63)
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- Squashed source: packages/db/drizzle/0019_storage_object_deletion_outbox.sql
-- Attachment object keys are tenant-owned. The trigger below makes that
-- invariant durable for future writes, but fail the migration explicitly if a
-- historical row would make deletion unsafe.
ALTER TABLE "attachments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
DECLARE
  invalid_count bigint;
BEGIN
  SELECT count(*)
  INTO invalid_count
  FROM "attachments"
  WHERE "r2_key" NOT LIKE ('t/' || "tenant_id"::text || '/%');

  IF invalid_count > 0 THEN
    RAISE EXCEPTION
      'Attachment storage-key preflight failed: % row(s) are not owned by their tenant',
      invalid_count;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE TYPE "public"."storage_object_deletion_status" AS ENUM('pending', 'deleting');--> statement-breakpoint
CREATE TABLE "storage_object_deletion_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"status" "storage_object_deletion_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_id" uuid,
	"claimed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_object_deletion_outbox_tenant_key_ck" CHECK ("storage_object_deletion_outbox"."object_key" like ('t/' || "storage_object_deletion_outbox"."tenant_id"::text || '/%')),
	CONSTRAINT "storage_object_deletion_outbox_attempts_ck" CHECK ("storage_object_deletion_outbox"."attempts" >= 0),
	CONSTRAINT "storage_object_deletion_outbox_lease_state_ck" CHECK ((
        ("storage_object_deletion_outbox"."status" = 'pending' AND "storage_object_deletion_outbox"."lease_id" IS NULL AND "storage_object_deletion_outbox"."claimed_at" IS NULL)
        OR
        ("storage_object_deletion_outbox"."status" = 'deleting' AND "storage_object_deletion_outbox"."lease_id" IS NOT NULL AND "storage_object_deletion_outbox"."claimed_at" IS NOT NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "storage_object_deletion_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "storage_object_deletion_outbox"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "storage_object_deletion_outbox" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "storage_object_deletion_outbox" ADD CONSTRAINT "storage_object_deletion_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "storage_object_deletion_outbox_tenant_id_id_ux" ON "storage_object_deletion_outbox" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_object_deletion_outbox_attachment_ux" ON "storage_object_deletion_outbox" USING btree ("attachment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_object_deletion_outbox_object_key_ux" ON "storage_object_deletion_outbox" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "storage_object_deletion_outbox_status_available_idx" ON "storage_object_deletion_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "storage_object_deletion_outbox_status_claimed_idx" ON "storage_object_deletion_outbox" USING btree ("status","claimed_at");--> statement-breakpoint
CREATE INDEX "storage_object_deletion_outbox_tenant_attachment_idx" ON "storage_object_deletion_outbox" USING btree ("tenant_id","attachment_id");--> statement-breakpoint

-- A committed attachment deletion and its storage intent are one transaction.
-- This is deliberately a plain INSERT: if an impossible duplicate attachment
-- id or active object key is encountered, the attachment DELETE rolls back
-- instead of silently losing a distinct deletion intent.
CREATE OR REPLACE FUNCTION "enqueue_attachment_storage_object_deletion"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.storage_object_deletion_outbox (
    tenant_id,
    attachment_id,
    object_key
  ) VALUES (
    OLD.tenant_id,
    OLD.id,
    OLD.r2_key
  );
  RETURN OLD;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "attachments_enqueue_storage_object_deletion" ON "attachments";--> statement-breakpoint
CREATE TRIGGER "attachments_enqueue_storage_object_deletion"
AFTER DELETE ON "attachments"
FOR EACH ROW
EXECUTE FUNCTION "enqueue_attachment_storage_object_deletion"();--> statement-breakpoint

-- Until an intent has been compare-and-deleted by its current lease holder,
-- the key still names the object being removed. Reusing it would let that
-- worker delete bytes belonging to a new attachment. The trigger also makes
-- the tenant-key rule durable for all future attachment writes.
CREATE OR REPLACE FUNCTION "guard_attachment_storage_object_key"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.r2_key NOT LIKE ('t/' || NEW.tenant_id::text || '/%') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'attachments_tenant_storage_key_ck',
      MESSAGE = 'Attachment object key does not belong to its tenant';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.storage_object_deletion_outbox deletion
    WHERE deletion.tenant_id = NEW.tenant_id
      AND deletion.object_key = NEW.r2_key
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      CONSTRAINT = 'attachments_active_deletion_key_guard',
      MESSAGE = 'Attachment object key has an active deletion intent';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "attachments_guard_storage_object_key" ON "attachments";--> statement-breakpoint
CREATE TRIGGER "attachments_guard_storage_object_key"
BEFORE INSERT OR UPDATE OF "tenant_id", "r2_key" ON "attachments"
FOR EACH ROW
EXECUTE FUNCTION "guard_attachment_storage_object_key"();
--> statement-breakpoint

-- Squashed source: packages/db/drizzle/0020_training_completion_cutover.sql
-- Clean-cutover migration for instructor-led completion and obsolete generated
-- credential artifacts. Migration 0019 must precede this file so deleting an
-- attachment durably records its object-store cleanup intent.

DO $$
DECLARE
  candidate_count bigint;
  conflict_count bigint;
  deleted_count bigint;
  queued_count bigint;
  attachment_ref record;
BEGIN
  IF to_regclass('public.storage_object_deletion_outbox') IS NULL THEN
    RAISE EXCEPTION 'Training cutover requires storage deletion migration 0019';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM training_class_attendees
    GROUP BY tenant_id, class_id, person_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Training completion preflight failed: duplicate class attendees exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM training_class_attendees
    GROUP BY tenant_id, class_id
    HAVING count(*) > 1000
  ) THEN
    RAISE EXCEPTION 'Training completion preflight failed: a class roster exceeds 1000 attendees';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM training_records
    WHERE class_id IS NOT NULL
      AND person_id IS NOT NULL
      AND deleted_at IS NULL
    GROUP BY tenant_id, class_id, person_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Training completion preflight failed: duplicate active class records exist';
  END IF;

  CREATE TEMP TABLE training_generated_attachment_cleanup (
    attachment_id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO training_generated_attachment_cleanup (attachment_id, tenant_id)
  SELECT attachment.id, attachment.tenant_id
  FROM training_certificates AS certificate
  JOIN attachments AS attachment
    ON attachment.id = certificate.pdf_attachment_id
   AND attachment.tenant_id = certificate.tenant_id
  WHERE certificate.pdf_attachment_id IS NOT NULL
  ON CONFLICT (attachment_id) DO NOTHING;

  INSERT INTO training_generated_attachment_cleanup (attachment_id, tenant_id)
  SELECT attachment.id, attachment.tenant_id
  FROM training_skill_certificates AS certificate
  JOIN attachments AS attachment
    ON attachment.id = certificate.pdf_attachment_id
   AND attachment.tenant_id = certificate.tenant_id
  WHERE certificate.pdf_attachment_id IS NOT NULL
  ON CONFLICT (attachment_id) DO NOTHING;

  -- Old certificate workers recorded both the full-size and wallet attachment
  -- IDs in exact export audit rows. This recovers wallet artifacts that never
  -- had a domain FK, without guessing from filenames.
  INSERT INTO training_generated_attachment_cleanup (attachment_id, tenant_id)
  SELECT attachment.id, attachment.tenant_id
  FROM (
    SELECT audit.tenant_id,
      CASE
        WHEN candidate.raw_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN candidate.raw_id::uuid
        ELSE NULL
      END AS attachment_id
    FROM audit_log AS audit
    CROSS JOIN LATERAL (
      VALUES
        (audit.metadata ->> 'certificateAttachmentId'),
        (audit.metadata ->> 'walletAttachmentId')
    ) AS candidate(raw_id)
    WHERE audit.action = 'export'
      AND audit.entity_type IN ('training_certificate', 'training_skill_certificate')
  ) AS audited
  JOIN attachments AS attachment
    ON attachment.id = audited.attachment_id
   AND attachment.tenant_id = audited.tenant_id
  WHERE audited.attachment_id IS NOT NULL
  ON CONFLICT (attachment_id) DO NOTHING;

  -- A generated artifact must not be deleted if it was intentionally reused by
  -- another attachment FK. Locate the child column paired with attachments.id
  -- for both simple and composite foreign keys; ignore only the two columns
  -- retired by this migration.
  FOR attachment_ref IN
    SELECT
      child.relname AS child_table,
      child_column.attname AS child_column,
      format('%I.%I', child_namespace.nspname, child.relname) AS child_relation
    FROM pg_constraint AS fk
    JOIN pg_class AS child ON child.oid = fk.conrelid
    JOIN pg_namespace AS child_namespace ON child_namespace.oid = child.relnamespace
    JOIN LATERAL unnest(fk.conkey) WITH ORDINALITY AS child_key(attnum, position) ON true
    JOIN LATERAL unnest(fk.confkey) WITH ORDINALITY AS parent_key(attnum, position)
      ON parent_key.position = child_key.position
    JOIN pg_attribute AS child_column
      ON child_column.attrelid = fk.conrelid
     AND child_column.attnum = child_key.attnum
    JOIN pg_attribute AS parent_column
      ON parent_column.attrelid = fk.confrelid
     AND parent_column.attnum = parent_key.attnum
    WHERE fk.contype = 'f'
      AND fk.confrelid = 'public.attachments'::regclass
      AND parent_column.attname = 'id'
      AND NOT (
        (child.relname = 'training_certificates' AND child_column.attname = 'pdf_attachment_id')
        OR
        (child.relname = 'training_skill_certificates' AND child_column.attname = 'pdf_attachment_id')
      )
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %s AS child JOIN pg_temp.training_generated_attachment_cleanup AS candidate ON child.%I = candidate.attachment_id',
      attachment_ref.child_relation,
      attachment_ref.child_column
    ) INTO conflict_count;
    IF conflict_count > 0 THEN
      RAISE EXCEPTION
        'Training artifact cleanup preflight failed: % candidate attachment(s) are referenced by %.%',
        conflict_count,
        attachment_ref.child_table,
        attachment_ref.child_column;
    END IF;
  END LOOP;

  -- These legacy JSON arrays are attachment references without database FKs.
  IF EXISTS (
    SELECT 1
    FROM training_generated_attachment_cleanup AS candidate
    JOIN training_courses AS course ON course.tenant_id = candidate.tenant_id
    WHERE course.material_attachment_ids @> jsonb_build_array(candidate.attachment_id::text)
  ) OR EXISTS (
    SELECT 1
    FROM training_generated_attachment_cleanup AS candidate
    JOIN inspection_record_criteria AS criterion ON criterion.tenant_id = candidate.tenant_id
    WHERE criterion.photo_attachment_ids @> jsonb_build_array(candidate.attachment_id::text)
  ) OR EXISTS (
    SELECT 1
    FROM training_generated_attachment_cleanup AS candidate
    JOIN equipment_inspection_record_criteria AS criterion
      ON criterion.tenant_id = candidate.tenant_id
    WHERE criterion.photo_attachment_ids @> jsonb_build_array(candidate.attachment_id::text)
  ) OR EXISTS (
    SELECT 1
    FROM training_generated_attachment_cleanup AS candidate
    JOIN safe_distance_records AS record ON record.tenant_id = candidate.tenant_id
    WHERE record.attachment_ids @> jsonb_build_array(candidate.attachment_id::text)
  ) OR EXISTS (
    SELECT 1
    FROM training_generated_attachment_cleanup AS candidate
    JOIN form_responses AS response ON response.tenant_id = candidate.tenant_id
    WHERE position(candidate.attachment_id::text IN response.data::text) > 0
       OR position(candidate.attachment_id::text IN coalesce(response.draft_data::text, '')) > 0
  ) THEN
    RAISE EXCEPTION 'Training artifact cleanup preflight failed: a candidate is reused in JSON data';
  END IF;

  SELECT count(*) INTO candidate_count FROM training_generated_attachment_cleanup;

  DELETE FROM attachments AS attachment
  USING training_generated_attachment_cleanup AS candidate
  WHERE attachment.id = candidate.attachment_id
    AND attachment.tenant_id = candidate.tenant_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  IF deleted_count <> candidate_count THEN
    RAISE EXCEPTION
      'Training artifact cleanup failed: expected to delete %, deleted %',
      candidate_count,
      deleted_count;
  END IF;

  SELECT count(*) INTO queued_count
  FROM storage_object_deletion_outbox AS deletion
  JOIN training_generated_attachment_cleanup AS candidate
    ON candidate.attachment_id = deletion.attachment_id
   AND candidate.tenant_id = deletion.tenant_id;

  IF queued_count <> candidate_count THEN
    RAISE EXCEPTION
      'Training artifact cleanup failed: expected % durable deletion intents, found %',
      candidate_count,
      queued_count;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "training_class_attendees" ADD COLUMN "completion_attended" boolean;
--> statement-breakpoint
ALTER TABLE "training_class_attendees" ADD COLUMN "completion_passed" boolean;
--> statement-breakpoint
ALTER TABLE "training_class_attendees" ADD COLUMN "completion_grade" integer;
--> statement-breakpoint
ALTER TABLE "training_class_attendees" ADD COLUMN "completion_reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "training_class_attendees" ADD COLUMN "completion_reviewed_by_tenant_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "training_class_attendees"
  ADD CONSTRAINT "training_class_attendees_tenant_completion_reviewer_fk"
  FOREIGN KEY ("tenant_id", "completion_reviewed_by_tenant_user_id")
  REFERENCES "public"."tenant_users"("tenant_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "training_class_attendees"
  VALIDATE CONSTRAINT "training_class_attendees_tenant_completion_reviewer_fk";
--> statement-breakpoint
CREATE UNIQUE INDEX "training_class_attendees_tenant_class_person_ux"
  ON "training_class_attendees" USING btree ("tenant_id", "class_id", "person_id");
--> statement-breakpoint
CREATE INDEX "training_class_attendees_completion_reviewer_idx"
  ON "training_class_attendees" USING btree ("tenant_id", "completion_reviewed_by_tenant_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "training_records_active_class_person_ux"
  ON "training_records" USING btree ("tenant_id", "class_id", "person_id")
  WHERE "training_records"."class_id" IS NOT NULL
    AND "training_records"."person_id" IS NOT NULL
    AND "training_records"."deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "training_certificates" DROP COLUMN "pdf_attachment_id";
--> statement-breakpoint
ALTER TABLE "training_skill_certificates" DROP COLUMN "pdf_attachment_id";
--> statement-breakpoint
ALTER TABLE "training_class_attendees"
  ADD CONSTRAINT "training_class_attendees_completion_grade_ck"
  CHECK (
    "completion_grade" IS NULL
    OR ("completion_grade" >= 0 AND "completion_grade" <= 100)
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "training_class_attendees"
  VALIDATE CONSTRAINT "training_class_attendees_completion_grade_ck";
--> statement-breakpoint
ALTER TABLE "training_class_attendees"
  ADD CONSTRAINT "training_class_attendees_completion_review_ck"
  CHECK (
    (
      "completion_reviewed_at" IS NULL
      AND "completion_reviewed_by_tenant_user_id" IS NULL
      AND "completion_attended" IS NULL
      AND "completion_passed" IS NULL
      AND "completion_grade" IS NULL
    ) OR (
      "completion_reviewed_at" IS NOT NULL
      AND "completion_attended" IS NOT NULL
      AND "completion_passed" IS NOT NULL
      AND ("completion_attended" OR NOT "completion_passed")
    )
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "training_class_attendees"
  VALIDATE CONSTRAINT "training_class_attendees_completion_review_ck";
--> statement-breakpoint

-- Squashed source: packages/db/drizzle/0021_training_record_value_guards.sql
DO $$
DECLARE
  invalid_count bigint;
BEGIN
  SELECT count(*)
    INTO invalid_count
    FROM training_records
   WHERE grade IS NOT NULL
     AND (grade < 0 OR grade > 100);

  IF invalid_count > 0 THEN
    RAISE EXCEPTION
      'Cannot install training_records_grade_ck: % training record(s) have a grade outside 0..100',
      invalid_count;
  END IF;
END $$;--> statement-breakpoint
DO $$
DECLARE
  invalid_count bigint;
BEGIN
  SELECT count(*)
    INTO invalid_count
    FROM training_skill_assignment_files
   WHERE kind NOT IN ('certificate', 'evidence', 'photo', 'other');

  IF invalid_count > 0 THEN
    RAISE EXCEPTION
      'Cannot install training_skill_assignment_files_kind_ck: % skill file(s) have an unsupported kind',
      invalid_count;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "training_records"
  ADD CONSTRAINT "training_records_grade_ck"
  CHECK ("training_records"."grade" IS NULL OR ("training_records"."grade" >= 0 AND "training_records"."grade" <= 100))
  NOT VALID;--> statement-breakpoint
ALTER TABLE "training_records"
  VALIDATE CONSTRAINT "training_records_grade_ck";--> statement-breakpoint
ALTER TABLE "training_skill_assignment_files"
  ADD CONSTRAINT "training_skill_assignment_files_kind_ck"
  CHECK ("training_skill_assignment_files"."kind" IN ('certificate', 'evidence', 'photo', 'other'))
  NOT VALID;--> statement-breakpoint
ALTER TABLE "training_skill_assignment_files"
  VALIDATE CONSTRAINT "training_skill_assignment_files_kind_ck";
--> statement-breakpoint

-- Squashed source: packages/db/drizzle/0022_durable_publication_leases.sql
ALTER TABLE "equipment_maintenance_dispatches" ADD COLUMN "publish_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment_maintenance_dispatches" ADD COLUMN "publish_available_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment_maintenance_dispatches" ADD COLUMN "publish_lease_id" uuid;--> statement-breakpoint
ALTER TABLE "equipment_maintenance_dispatches" ADD COLUMN "publish_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "report_runs" ADD COLUMN "publish_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "report_runs" ADD COLUMN "publish_available_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "report_runs" ADD COLUMN "publish_lease_id" uuid;--> statement-breakpoint
ALTER TABLE "report_runs" ADD COLUMN "publish_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "form_assignment_dispatches" ADD COLUMN "publish_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "form_assignment_dispatches" ADD COLUMN "publish_available_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "form_assignment_dispatches" ADD COLUMN "publish_lease_id" uuid;--> statement-breakpoint
ALTER TABLE "form_assignment_dispatches" ADD COLUMN "publish_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "compliance_dispatches" ADD COLUMN "publish_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance_dispatches" ADD COLUMN "publish_available_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance_dispatches" ADD COLUMN "publish_lease_id" uuid;--> statement-breakpoint
ALTER TABLE "compliance_dispatches" ADD COLUMN "publish_claimed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "equipment_maintenance_dispatches_publish_available_idx" ON "equipment_maintenance_dispatches" USING btree ("status","publish_available_at");--> statement-breakpoint
CREATE INDEX "equipment_maintenance_dispatches_publish_claimed_idx" ON "equipment_maintenance_dispatches" USING btree ("status","publish_claimed_at");--> statement-breakpoint
CREATE INDEX "report_runs_publish_available_idx" ON "report_runs" USING btree ("status","publish_available_at");--> statement-breakpoint
CREATE INDEX "report_runs_publish_claimed_idx" ON "report_runs" USING btree ("status","publish_claimed_at");--> statement-breakpoint
CREATE INDEX "form_assignment_dispatches_publish_available_idx" ON "form_assignment_dispatches" USING btree ("status","publish_available_at");--> statement-breakpoint
CREATE INDEX "form_assignment_dispatches_publish_claimed_idx" ON "form_assignment_dispatches" USING btree ("status","publish_claimed_at");--> statement-breakpoint
CREATE INDEX "compliance_dispatches_publish_available_idx" ON "compliance_dispatches" USING btree ("status","publish_available_at");--> statement-breakpoint
CREATE INDEX "compliance_dispatches_publish_claimed_idx" ON "compliance_dispatches" USING btree ("status","publish_claimed_at");--> statement-breakpoint
ALTER TABLE "equipment_maintenance_dispatches" ADD CONSTRAINT "equipment_maintenance_dispatches_publish_attempts_ck" CHECK ("equipment_maintenance_dispatches"."publish_attempts" >= 0);--> statement-breakpoint
ALTER TABLE "equipment_maintenance_dispatches" ADD CONSTRAINT "equipment_maintenance_dispatches_publish_lease_state_ck" CHECK ((
        ("equipment_maintenance_dispatches"."status" = 'queued' AND (
          ("equipment_maintenance_dispatches"."publish_lease_id" IS NULL AND "equipment_maintenance_dispatches"."publish_claimed_at" IS NULL)
          OR
          ("equipment_maintenance_dispatches"."publish_lease_id" IS NOT NULL AND "equipment_maintenance_dispatches"."publish_claimed_at" IS NOT NULL)
        ))
        OR
        ("equipment_maintenance_dispatches"."status" <> 'queued' AND "equipment_maintenance_dispatches"."publish_lease_id" IS NULL AND "equipment_maintenance_dispatches"."publish_claimed_at" IS NULL)
      ));--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_publish_attempts_ck" CHECK ("report_runs"."publish_attempts" >= 0);--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_publish_lease_state_ck" CHECK ((
        ("report_runs"."status" = 'queued' AND (
          ("report_runs"."publish_lease_id" IS NULL AND "report_runs"."publish_claimed_at" IS NULL)
          OR
          ("report_runs"."publish_lease_id" IS NOT NULL AND "report_runs"."publish_claimed_at" IS NOT NULL)
        ))
        OR
        ("report_runs"."status" <> 'queued' AND "report_runs"."publish_lease_id" IS NULL AND "report_runs"."publish_claimed_at" IS NULL)
      ));--> statement-breakpoint
ALTER TABLE "form_assignment_dispatches" ADD CONSTRAINT "form_assignment_dispatches_publish_attempts_ck" CHECK ("form_assignment_dispatches"."publish_attempts" >= 0);--> statement-breakpoint
ALTER TABLE "form_assignment_dispatches" ADD CONSTRAINT "form_assignment_dispatches_publish_lease_state_ck" CHECK ((
        ("form_assignment_dispatches"."status" = 'queued' AND (
          ("form_assignment_dispatches"."publish_lease_id" IS NULL AND "form_assignment_dispatches"."publish_claimed_at" IS NULL)
          OR
          ("form_assignment_dispatches"."publish_lease_id" IS NOT NULL AND "form_assignment_dispatches"."publish_claimed_at" IS NOT NULL)
        ))
        OR
        ("form_assignment_dispatches"."status" <> 'queued' AND "form_assignment_dispatches"."publish_lease_id" IS NULL AND "form_assignment_dispatches"."publish_claimed_at" IS NULL)
      ));--> statement-breakpoint
ALTER TABLE "compliance_dispatches" ADD CONSTRAINT "compliance_dispatches_publish_attempts_ck" CHECK ("compliance_dispatches"."publish_attempts" >= 0);--> statement-breakpoint
ALTER TABLE "compliance_dispatches" ADD CONSTRAINT "compliance_dispatches_publish_lease_state_ck" CHECK ((
        ("compliance_dispatches"."status" = 'queued' AND (
          ("compliance_dispatches"."publish_lease_id" IS NULL AND "compliance_dispatches"."publish_claimed_at" IS NULL)
          OR
          ("compliance_dispatches"."publish_lease_id" IS NOT NULL AND "compliance_dispatches"."publish_claimed_at" IS NOT NULL)
        ))
        OR
        ("compliance_dispatches"."status" <> 'queued' AND "compliance_dispatches"."publish_lease_id" IS NULL AND "compliance_dispatches"."publish_claimed_at" IS NULL)
      ));
--> statement-breakpoint

-- Squashed source: packages/db/drizzle/0023_flaky_squirrel_girl.sql
-- FORCE RLS would hide other tenants from the NOLOGIN owner that runs
-- migrations. Relax FORCE only on the scanned tables. ALTER TABLE takes and
-- retains the required table locks for this transaction, so the preflight and
-- subsequent constraints describe one stable data set. RLS itself remains
-- enabled for non-owners throughout.
ALTER TABLE "corrective_actions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_responses" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_extra_fields" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_skill_assignments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_skill_types" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_skill_authorities" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Fail closed before changing physical ownership or adding uniqueness. These
-- are business identifiers, so silently renaming or discarding conflicting
-- rows would be data corruption. The operator receives the exact invariant
-- and can resolve any legacy conflict explicitly before retrying.
DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*)
  INTO violation_count
  FROM "corrective_actions" AS action
  LEFT JOIN "form_responses" AS response
    ON response."tenant_id" = action."tenant_id"
   AND response."id" = action."source_form_response_id"
  WHERE action."source_form_response_id" IS NOT NULL
    AND response."id" IS NULL;

  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'corrective_actions source response cutover blocked: % row(s) reference a missing or cross-tenant form response',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM (
    SELECT document."tenant_id", lower(document."key")
    FROM "documents" AS document
    WHERE document."deleted_at" IS NULL
    GROUP BY document."tenant_id", lower(document."key")
    HAVING count(*) > 1
  ) AS duplicate_document_keys;

  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'document key cutover blocked: % tenant/key group(s) contain case-insensitive duplicate live document keys',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "training_extra_fields" AS extra_field
  LEFT JOIN "training_skill_assignments" AS assignment
    ON extra_field."owner_type" = 'skill'
   AND assignment."tenant_id" = extra_field."tenant_id"
   AND assignment."id" = extra_field."owner_id"
  LEFT JOIN "training_skill_types" AS skill_type
    ON extra_field."owner_type" = 'skill_type'
   AND skill_type."tenant_id" = extra_field."tenant_id"
   AND skill_type."id" = extra_field."owner_id"
  LEFT JOIN "training_skill_authorities" AS authority
    ON extra_field."owner_type" = 'authority'
   AND authority."tenant_id" = extra_field."tenant_id"
   AND authority."id" = extra_field."owner_id"
  WHERE (extra_field."owner_type" = 'skill' AND assignment."id" IS NULL)
     OR (extra_field."owner_type" = 'skill_type' AND skill_type."id" IS NULL)
     OR (extra_field."owner_type" = 'authority' AND authority."id" IS NULL);

  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'training additional-field cutover blocked: % row(s) reference a missing or cross-tenant owner',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM (
    SELECT extra_field."tenant_id", extra_field."owner_type", extra_field."owner_id", lower(extra_field."field_key")
    FROM "training_extra_fields" AS extra_field
    GROUP BY extra_field."tenant_id", extra_field."owner_type", extra_field."owner_id", lower(extra_field."field_key")
    HAVING count(*) > 1
  ) AS duplicate_training_field_keys;

  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'training additional-field cutover blocked: % owner/key group(s) contain case-insensitive duplicate field names',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "corrective_actions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_responses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_extra_fields" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_skill_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_skill_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_skill_authorities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DROP INDEX "documents_key_idx";--> statement-breakpoint
DROP INDEX "training_extra_fields_owner_idx";--> statement-breakpoint
DROP INDEX "ai_messages_conversation_idx";--> statement-breakpoint

ALTER TABLE "training_extra_fields" ADD COLUMN "skill_assignment_id" uuid;--> statement-breakpoint
ALTER TABLE "training_extra_fields" ADD COLUMN "skill_type_id" uuid;--> statement-breakpoint
ALTER TABLE "training_extra_fields" ADD COLUMN "authority_id" uuid;--> statement-breakpoint

UPDATE "training_extra_fields"
SET "skill_assignment_id" = "owner_id"
WHERE "owner_type" = 'skill';--> statement-breakpoint
UPDATE "training_extra_fields"
SET "skill_type_id" = "owner_id"
WHERE "owner_type" = 'skill_type';--> statement-breakpoint
UPDATE "training_extra_fields"
SET "authority_id" = "owner_id"
WHERE "owner_type" = 'authority';--> statement-breakpoint

ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_tenant_source_response_fk" FOREIGN KEY ("tenant_id","source_form_response_id") REFERENCES "public"."form_responses"("tenant_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "corrective_actions" VALIDATE CONSTRAINT "corrective_actions_tenant_source_response_fk";--> statement-breakpoint
ALTER TABLE "training_extra_fields" ADD CONSTRAINT "training_extra_fields_tenant_skill_assignment_fk" FOREIGN KEY ("tenant_id","skill_assignment_id") REFERENCES "public"."training_skill_assignments"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "training_extra_fields" VALIDATE CONSTRAINT "training_extra_fields_tenant_skill_assignment_fk";--> statement-breakpoint
ALTER TABLE "training_extra_fields" ADD CONSTRAINT "training_extra_fields_tenant_skill_type_fk" FOREIGN KEY ("tenant_id","skill_type_id") REFERENCES "public"."training_skill_types"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "training_extra_fields" VALIDATE CONSTRAINT "training_extra_fields_tenant_skill_type_fk";--> statement-breakpoint
ALTER TABLE "training_extra_fields" ADD CONSTRAINT "training_extra_fields_tenant_authority_fk" FOREIGN KEY ("tenant_id","authority_id") REFERENCES "public"."training_skill_authorities"("tenant_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "training_extra_fields" VALIDATE CONSTRAINT "training_extra_fields_tenant_authority_fk";--> statement-breakpoint
ALTER TABLE "training_extra_fields" ADD CONSTRAINT "training_extra_fields_exactly_one_owner_ck" CHECK (num_nonnulls("training_extra_fields"."skill_assignment_id", "training_extra_fields"."skill_type_id", "training_extra_fields"."authority_id") = 1) NOT VALID;--> statement-breakpoint
ALTER TABLE "training_extra_fields" VALIDATE CONSTRAINT "training_extra_fields_exactly_one_owner_ck";--> statement-breakpoint

CREATE INDEX "ai_conversations_owner_scope_updated_idx" ON "ai_conversations" USING btree ("tenant_id","user_id","scope","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_tenant_key_live_ux" ON "documents" USING btree ("tenant_id",lower("key")) WHERE "documents"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "corrective_actions_source_response_idx" ON "corrective_actions" USING btree ("tenant_id","source_form_response_id");--> statement-breakpoint
CREATE INDEX "training_extra_fields_skill_assignment_idx" ON "training_extra_fields" USING btree ("tenant_id","skill_assignment_id");--> statement-breakpoint
CREATE INDEX "training_extra_fields_skill_type_idx" ON "training_extra_fields" USING btree ("tenant_id","skill_type_id");--> statement-breakpoint
CREATE INDEX "training_extra_fields_authority_idx" ON "training_extra_fields" USING btree ("tenant_id","authority_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_extra_fields_skill_assignment_key_ux" ON "training_extra_fields" USING btree ("tenant_id","skill_assignment_id",lower("field_key")) WHERE "training_extra_fields"."skill_assignment_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "training_extra_fields_skill_type_key_ux" ON "training_extra_fields" USING btree ("tenant_id","skill_type_id",lower("field_key")) WHERE "training_extra_fields"."skill_type_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "training_extra_fields_authority_key_ux" ON "training_extra_fields" USING btree ("tenant_id","authority_id",lower("field_key")) WHERE "training_extra_fields"."authority_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_messages_conversation_idx" ON "ai_messages" USING btree ("conversation_id","created_at","id");--> statement-breakpoint

ALTER TABLE "training_extra_fields" DROP COLUMN "owner_type";--> statement-breakpoint
ALTER TABLE "training_extra_fields" DROP COLUMN "owner_id";--> statement-breakpoint
DROP TYPE "public"."training_extra_field_owner_type";

-- Squashed source: packages/db/drizzle/0024_incident_injury_taxonomy_cutover.sql
-- The legacy injury row stored two different concepts in overlapping columns:
-- a managed single taxonomy FK and a JSON array which the company ETL used for
-- the free-text Result value. Preserve both meanings explicitly before the old
-- columns disappear.
ALTER TABLE "incident_injuries" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_injury_types" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "incident_injuries" ADD COLUMN "injury_result" text;--> statement-breakpoint
CREATE TABLE "incident_injury_type_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"injury_id" uuid NOT NULL,
	"injury_type_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_injury_type_assignments_tenant_id_tenants_id_fk"
		FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade,
	CONSTRAINT "incident_injury_type_assignments_tenant_injury_fk"
		FOREIGN KEY ("tenant_id", "injury_id")
		REFERENCES "public"."incident_injuries"("tenant_id", "id") ON DELETE cascade,
	CONSTRAINT "incident_injury_type_assignments_tenant_type_fk"
		FOREIGN KEY ("tenant_id", "injury_type_id")
		REFERENCES "public"."incident_injury_types"("tenant_id", "id")
);--> statement-breakpoint
ALTER TABLE "incident_injury_type_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_injury_type_assignments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "incident_injury_type_assignments_tenant_idx"
	ON "incident_injury_type_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "incident_injury_type_assignments_injury_idx"
	ON "incident_injury_type_assignments" USING btree ("tenant_id", "injury_id");--> statement-breakpoint
CREATE INDEX "incident_injury_type_assignments_type_idx"
	ON "incident_injury_type_assignments" USING btree ("tenant_id", "injury_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_injury_type_assignments_injury_type_ux"
	ON "incident_injury_type_assignments" USING btree ("tenant_id", "injury_id", "injury_type_id");--> statement-breakpoint

CREATE TEMP TABLE "_incident_etl_injuries" (
	"injury_id" uuid PRIMARY KEY,
	"tenant_id" uuid NOT NULL
) ON COMMIT DROP;--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  IF to_regclass('etl.id_map') IS NOT NULL THEN
    EXECUTE $query$
      INSERT INTO "_incident_etl_injuries" ("injury_id", "tenant_id")
      SELECT injury."id", injury."tenant_id"
      FROM "incident_injuries" AS injury
      JOIN etl.id_map AS map
        ON map.source_db = 'beaconhs'
       AND map.source_table = 'INCIDENTLOG_INJURY'
       AND map.new_id = injury."id"
      WHERE map.tenant_id = injury."tenant_id"
    $query$;

    EXECUTE $query$
      SELECT count(*)
      FROM etl.id_map AS map
      JOIN "incident_injuries" AS injury ON injury."id" = map.new_id
      WHERE map.source_db = 'beaconhs'
        AND map.source_table = 'INCIDENTLOG_INJURY'
        AND map.tenant_id <> injury."tenant_id"
    $query$ INTO violation_count;
    IF violation_count > 0 THEN
      RAISE EXCEPTION
        'Incident injury cutover blocked: % ETL crosswalk row(s) resolve across tenants',
        violation_count;
    END IF;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "incident_injuries" AS injury
  WHERE jsonb_typeof(injury."injury_types") IS DISTINCT FROM 'array';
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Incident injury cutover blocked: % row(s) have a non-array injury_types value',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "incident_injuries" AS injury
  WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements(injury."injury_types") AS value
    WHERE jsonb_typeof(value) <> 'string'
  );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Incident injury cutover blocked: % row(s) have a non-string injury_types value',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM (
    SELECT injury."tenant_id", injury."id", label.value
    FROM "incident_injuries" AS injury
    LEFT JOIN "_incident_etl_injuries" AS imported ON imported."injury_id" = injury."id"
    CROSS JOIN LATERAL jsonb_array_elements_text(injury."injury_types") AS label(value)
    LEFT JOIN LATERAL (
      SELECT count(*) AS matches
      FROM "incident_injury_types" AS injury_type
      WHERE injury_type."tenant_id" = injury."tenant_id"
        AND injury_type."deleted_at" IS NULL
        AND lower(btrim(injury_type."name")) = lower(
          CASE btrim(label.value)
            WHEN 'Strain' THEN 'Strain / sprain'
            WHEN 'Bruise' THEN 'Contusion / bruise'
            ELSE btrim(label.value)
          END
        )
    ) AS taxonomy ON true
    WHERE imported."injury_id" IS NULL
      AND nullif(btrim(label.value), '') IS NOT NULL
      AND taxonomy.matches <> 1
  ) AS unresolved_labels;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Incident injury cutover blocked: % non-ETL taxonomy label(s) are unresolved or ambiguous',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "incident_injuries" AS injury
  LEFT JOIN "incident_injury_types" AS injury_type
    ON injury_type."tenant_id" = injury."tenant_id"
   AND injury_type."id" = injury."injury_type_id"
  WHERE injury."injury_type_id" IS NOT NULL
    AND injury_type."id" IS NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Incident injury cutover blocked: % managed injury type FK(s) are missing or cross-tenant',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

-- For ETL rows, injury_types was the legacy Result field. Preserve every
-- non-blank array element in order as descriptive text; do not taxonomy-map it.
UPDATE "incident_injuries" AS injury
SET "injury_result" = (
  SELECT nullif(string_agg(nullif(btrim(label.value), ''), '; ' ORDER BY label.ordinality), '')
  FROM jsonb_array_elements_text(injury."injury_types") WITH ORDINALITY AS label(value, ordinality)
)
FROM "_incident_etl_injuries" AS imported
WHERE imported."injury_id" = injury."id"
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(injury."injury_types") AS label(value)
    WHERE nullif(btrim(label.value), '') IS NOT NULL
  );--> statement-breakpoint

-- The explicit managed FK was always taxonomy data, including on ETL rows.
INSERT INTO "incident_injury_type_assignments" (
  "tenant_id", "injury_id", "injury_type_id", "created_at", "updated_at"
)
SELECT injury."tenant_id", injury."id", injury."injury_type_id", injury."created_at", injury."updated_at"
FROM "incident_injuries" AS injury
WHERE injury."injury_type_id" IS NOT NULL
ON CONFLICT ("tenant_id", "injury_id", "injury_type_id") DO NOTHING;--> statement-breakpoint

-- App/demo rows used injury_types as taxonomy labels. Map the reviewed aliases
-- explicitly and require an unambiguous active tenant taxonomy match.
INSERT INTO "incident_injury_type_assignments" (
  "tenant_id", "injury_id", "injury_type_id", "created_at", "updated_at"
)
SELECT injury."tenant_id", injury."id", injury_type."id", injury."created_at", injury."updated_at"
FROM "incident_injuries" AS injury
LEFT JOIN "_incident_etl_injuries" AS imported ON imported."injury_id" = injury."id"
CROSS JOIN LATERAL jsonb_array_elements_text(injury."injury_types") AS label(value)
JOIN "incident_injury_types" AS injury_type
  ON injury_type."tenant_id" = injury."tenant_id"
 AND injury_type."deleted_at" IS NULL
 AND lower(btrim(injury_type."name")) = lower(
   CASE btrim(label.value)
     WHEN 'Strain' THEN 'Strain / sprain'
     WHEN 'Bruise' THEN 'Contusion / bruise'
     ELSE btrim(label.value)
   END
 )
WHERE imported."injury_id" IS NULL
  AND nullif(btrim(label.value), '') IS NOT NULL
ON CONFLICT ("tenant_id", "injury_id", "injury_type_id") DO NOTHING;--> statement-breakpoint

DO $$
DECLARE
  expected_count bigint;
  actual_count bigint;
BEGIN
  SELECT count(*) INTO expected_count
  FROM "incident_injuries"
  WHERE "injury_type_id" IS NOT NULL;
  SELECT count(*) INTO actual_count
  FROM "incident_injuries" AS injury
  JOIN "incident_injury_type_assignments" AS assignment
    ON assignment."tenant_id" = injury."tenant_id"
   AND assignment."injury_id" = injury."id"
   AND assignment."injury_type_id" = injury."injury_type_id"
  WHERE injury."injury_type_id" IS NOT NULL;
  IF actual_count <> expected_count THEN
    RAISE EXCEPTION
      'Incident injury cutover verification failed: % managed FK(s), % canonical assignment(s)',
      expected_count, actual_count;
  END IF;

  SELECT count(*) INTO expected_count
  FROM "_incident_etl_injuries" AS imported
  JOIN "incident_injuries" AS injury ON injury."id" = imported."injury_id"
  WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(injury."injury_types") AS label(value)
    WHERE nullif(btrim(label.value), '') IS NOT NULL
  );
  SELECT count(*) INTO actual_count
  FROM "_incident_etl_injuries" AS imported
  JOIN "incident_injuries" AS injury ON injury."id" = imported."injury_id"
  WHERE injury."injury_result" IS NOT NULL;
  IF actual_count <> expected_count THEN
    RAISE EXCEPTION
      'Incident injury Result cutover verification failed: % source row(s), % preserved result(s)',
      expected_count, actual_count;
  END IF;
END
$$;--> statement-breakpoint

CREATE POLICY "tenant_isolation" ON "incident_injury_type_assignments"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "incident_injuries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_injury_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_injury_type_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DROP INDEX "incident_injuries_injury_type_idx";--> statement-breakpoint
ALTER TABLE "incident_injuries" DROP COLUMN "injury_type_id";--> statement-breakpoint
ALTER TABLE "incident_injuries" DROP COLUMN "injury_types";

-- Squashed source: packages/db/drizzle/0025_document_version_snapshot_integrity.sql
-- A published book is an immutable snapshot. Pin every existing published
-- membership to the exact latest published/readable version before installing
-- the composite relationship used by the worker and download routes.
ALTER TABLE "document_book_items" ADD COLUMN "document_version_id" uuid;--> statement-breakpoint

ALTER TABLE "attachments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_versions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_books" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_book_items" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_acknowledgment_sessions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_acknowledgments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- The original book implementation stored its title, category and ordered
-- membership inline. Normalize that data before the published-snapshot checks
-- below so the relational items are the only membership model left at cutover.
DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*)
  INTO violation_count
  FROM "document_books"
  WHERE jsonb_typeof("contents") IS DISTINCT FROM 'array';
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document book legacy-content cutover blocked: % book(s) have non-array contents',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "document_books" AS book
  CROSS JOIN LATERAL jsonb_array_elements(book."contents") AS entry(value)
  WHERE jsonb_typeof(entry.value) IS DISTINCT FROM 'object'
     OR jsonb_typeof(entry.value -> 'documentId') IS DISTINCT FROM 'string'
     OR (entry.value ->> 'documentId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR (
       entry.value ? 'versionId'
       AND entry.value -> 'versionId' <> 'null'::jsonb
       AND (
         jsonb_typeof(entry.value -> 'versionId') IS DISTINCT FROM 'string'
         OR (entry.value ->> 'versionId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       )
     );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document book legacy-content cutover blocked: % membership value(s) have an invalid documentId/versionId shape',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM (
    SELECT book."id", entry.value ->> 'documentId'
    FROM "document_books" AS book
    CROSS JOIN LATERAL jsonb_array_elements(book."contents") AS entry(value)
    GROUP BY book."id", entry.value ->> 'documentId'
    HAVING count(*) > 1
  ) AS duplicate_membership;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document book legacy-content cutover blocked: % book/document pair(s) are duplicated',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "document_books" AS book
  CROSS JOIN LATERAL jsonb_array_elements(book."contents") AS entry(value)
  LEFT JOIN "documents" AS document
    ON document."tenant_id" = book."tenant_id"
   AND document."id" = (entry.value ->> 'documentId')::uuid
  WHERE document."id" IS NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document book legacy-content cutover blocked: % membership(s) reference a missing or cross-tenant document',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "document_books" AS book
  CROSS JOIN LATERAL jsonb_array_elements(book."contents") AS entry(value)
  LEFT JOIN "document_versions" AS version
    ON version."tenant_id" = book."tenant_id"
   AND version."document_id" = (entry.value ->> 'documentId')::uuid
   AND version."id" = (entry.value ->> 'versionId')::uuid
  WHERE nullif(entry.value ->> 'versionId', '') IS NOT NULL
    AND (
      version."id" IS NULL
      OR version."published_at" IS NULL
      OR book."status" = 'draft'
    );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document book legacy-content cutover blocked: % version pin(s) are missing, unpublished, cross-tenant, or attached to a draft book',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "document_books" AS book
  WHERE nullif(btrim(book."name"), '') IS NOT NULL
    AND nullif(btrim(book."title"), '') IS NOT NULL
    AND lower(btrim(book."name")) <> lower(btrim(book."title"));
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document book legacy-title cutover blocked: % book(s) have conflicting name and title values',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "document_books" AS book
  JOIN "document_categories" AS category
    ON category."tenant_id" = book."tenant_id"
   AND category."id" = book."category_id"
  WHERE nullif(btrim(book."category"), '') IS NOT NULL
    AND (
      category."deleted_at" IS NOT NULL
      OR lower(btrim(category."name")) <> lower(btrim(book."category"))
    );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document book legacy-category cutover blocked: % book(s) conflict with their canonical category',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "document_books" AS book
  WHERE book."category_id" IS NULL
    AND nullif(btrim(book."category"), '') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM "document_categories" AS category
      WHERE category."tenant_id" = book."tenant_id"
        AND category."parent_id" IS NULL
        AND category."deleted_at" IS NOT NULL
        AND lower(btrim(category."name")) = lower(btrim(book."category"))
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "document_categories" AS category
      WHERE category."tenant_id" = book."tenant_id"
        AND category."parent_id" IS NULL
        AND category."deleted_at" IS NULL
        AND lower(btrim(category."name")) = lower(btrim(book."category"))
    );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document book legacy-category cutover blocked: % book(s) resolve only to a deleted category',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "document_books" AS book
  WHERE jsonb_array_length(book."contents") > 0
    AND EXISTS (
      SELECT 1 FROM "document_book_items" AS item
      WHERE item."tenant_id" = book."tenant_id" AND item."book_id" = book."id"
    )
    AND (
      EXISTS (
        SELECT (entry.value ->> 'documentId')::uuid AS document_id,
               (entry.ordinality - 1)::integer AS position
        FROM jsonb_array_elements(book."contents") WITH ORDINALITY AS entry(value, ordinality)
        EXCEPT
        SELECT item."document_id", item."position"
        FROM "document_book_items" AS item
        WHERE item."tenant_id" = book."tenant_id" AND item."book_id" = book."id"
      )
      OR EXISTS (
        SELECT item."document_id", item."position"
        FROM "document_book_items" AS item
        WHERE item."tenant_id" = book."tenant_id" AND item."book_id" = book."id"
        EXCEPT
        SELECT (entry.value ->> 'documentId')::uuid AS document_id,
               (entry.ordinality - 1)::integer AS position
        FROM jsonb_array_elements(book."contents") WITH ORDINALITY AS entry(value, ordinality)
      )
    );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document book legacy-content cutover blocked: % book(s) disagree with canonical relational membership',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

UPDATE "document_books"
SET "title" = btrim("name"),
    "updated_at" = now()
WHERE nullif(btrim("title"), '') IS NULL
  AND nullif(btrim("name"), '') IS NOT NULL;--> statement-breakpoint

INSERT INTO "document_categories" ("tenant_id", "name", "created_at", "updated_at")
SELECT book."tenant_id", min(btrim(book."category")), now(), now()
FROM "document_books" AS book
WHERE book."category_id" IS NULL
  AND nullif(btrim(book."category"), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "document_categories" AS category
    WHERE category."tenant_id" = book."tenant_id"
      AND category."parent_id" IS NULL
      AND category."deleted_at" IS NULL
      AND lower(btrim(category."name")) = lower(btrim(book."category"))
  )
GROUP BY book."tenant_id", lower(btrim(book."category"));--> statement-breakpoint

UPDATE "document_books" AS book
SET "category_id" = category."id",
    "updated_at" = now()
FROM "document_categories" AS category
WHERE book."category_id" IS NULL
  AND nullif(btrim(book."category"), '') IS NOT NULL
  AND category."tenant_id" = book."tenant_id"
  AND category."parent_id" IS NULL
  AND category."deleted_at" IS NULL
  AND lower(btrim(category."name")) = lower(btrim(book."category"));--> statement-breakpoint

INSERT INTO "document_book_items" (
  "tenant_id", "book_id", "document_id", "document_version_id", "position", "created_at", "updated_at"
)
SELECT book."tenant_id",
       book."id",
       (entry.value ->> 'documentId')::uuid,
       CASE
         WHEN book."status" = 'published' THEN (entry.value ->> 'versionId')::uuid
         ELSE NULL
       END,
       (entry.ordinality - 1)::integer,
       book."created_at",
       book."updated_at"
FROM "document_books" AS book
CROSS JOIN LATERAL jsonb_array_elements(book."contents")
  WITH ORDINALITY AS entry(value, ordinality)
WHERE NOT EXISTS (
  SELECT 1 FROM "document_book_items" AS item
  WHERE item."tenant_id" = book."tenant_id" AND item."book_id" = book."id"
);--> statement-breakpoint

UPDATE "document_book_items" AS item
SET "document_version_id" = (entry.value ->> 'versionId')::uuid,
    "updated_at" = now()
FROM "document_books" AS book
CROSS JOIN LATERAL jsonb_array_elements(book."contents")
  WITH ORDINALITY AS entry(value, ordinality)
WHERE book."status" = 'published'
  AND item."tenant_id" = book."tenant_id"
  AND item."book_id" = book."id"
  AND item."document_id" = (entry.value ->> 'documentId')::uuid
  AND item."position" = (entry.ordinality - 1)::integer
  AND nullif(entry.value ->> 'versionId', '') IS NOT NULL;--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*)
  INTO violation_count
  FROM "document_books" AS book
  WHERE (nullif(btrim(book."name"), '') IS NOT NULL AND nullif(btrim(book."title"), '') IS NULL)
     OR (nullif(btrim(book."category"), '') IS NOT NULL AND book."category_id" IS NULL)
     OR (
       jsonb_array_length(book."contents") > 0
       AND NOT EXISTS (
         SELECT 1 FROM "document_book_items" AS item
         WHERE item."tenant_id" = book."tenant_id" AND item."book_id" = book."id"
       )
     );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document book legacy-field cutover verification failed: % book(s) lack canonical title, category, or membership',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

CREATE TEMP TABLE "_document_book_version_pins" (
  "item_id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "version_id" uuid NOT NULL
) ON COMMIT DROP;--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*)
  INTO violation_count
  FROM "document_books" AS book
  WHERE book."status" = 'published'
    AND (
      book."published_at" IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM "document_book_items" AS item
        WHERE item."tenant_id" = book."tenant_id"
          AND item."book_id" = book."id"
      )
    );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document book snapshot cutover blocked: % published book(s) have no publication timestamp or no items',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "document_book_items" AS item
  JOIN "document_books" AS book
    ON book."tenant_id" = item."tenant_id"
   AND book."id" = item."book_id"
  LEFT JOIN "documents" AS document
    ON document."tenant_id" = item."tenant_id"
   AND document."id" = item."document_id"
  WHERE book."status" = 'published'
    AND (
      document."id" IS NULL
      OR document."deleted_at" IS NOT NULL
      OR document."status" <> 'published'
    );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document book snapshot cutover blocked: % published item(s) do not reference a live published document',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "document_acknowledgment_sessions" AS session
  LEFT JOIN "document_versions" AS version
    ON version."tenant_id" = session."tenant_id"
   AND version."document_id" = session."document_id"
   AND version."id" = session."version_id"
  WHERE version."id" IS NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document version relationship cutover blocked: % acknowledgment session(s) reference a different document version',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "document_acknowledgments" AS acknowledgment
  LEFT JOIN "document_versions" AS version
    ON version."tenant_id" = acknowledgment."tenant_id"
   AND version."document_id" = acknowledgment."document_id"
   AND version."id" = acknowledgment."version_id"
  LEFT JOIN "document_acknowledgment_sessions" AS session
    ON session."tenant_id" = acknowledgment."tenant_id"
   AND session."document_id" = acknowledgment."document_id"
   AND session."version_id" = acknowledgment."version_id"
   AND session."id" = acknowledgment."session_id"
  WHERE version."id" IS NULL
     OR (acknowledgment."session_id" IS NOT NULL AND session."id" IS NULL);
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document version relationship cutover blocked: % acknowledgment(s) have a mismatched document, version, or session',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM (
    SELECT "tenant_id", "document_id", "version_id", "person_id"
    FROM "document_acknowledgments"
    GROUP BY "tenant_id", "document_id", "version_id", "person_id"
    HAVING count(*) > 1
  ) AS duplicate_acknowledgments;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document acknowledgment cutover blocked: % tenant/document/version/person group(s) contain duplicates',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

INSERT INTO "_document_book_version_pins" ("item_id", "tenant_id", "document_id", "version_id")
SELECT item."id", item."tenant_id", item."document_id", version."id"
FROM "document_book_items" AS item
JOIN "document_books" AS book
  ON book."tenant_id" = item."tenant_id"
 AND book."id" = item."book_id"
JOIN LATERAL (
  SELECT candidate."id"
  FROM "document_versions" AS candidate
  WHERE candidate."tenant_id" = item."tenant_id"
    AND candidate."document_id" = item."document_id"
    AND candidate."published_at" IS NOT NULL
    AND (item."document_version_id" IS NULL OR candidate."id" = item."document_version_id")
  ORDER BY candidate."version" DESC, candidate."id" DESC
  LIMIT 1
) AS version ON true
WHERE book."status" = 'published';--> statement-breakpoint

DO $$
DECLARE
  expected_count bigint;
  pinned_count bigint;
  unreadable_count bigint;
BEGIN
  SELECT count(*)
  INTO expected_count
  FROM "document_book_items" AS item
  JOIN "document_books" AS book
    ON book."tenant_id" = item."tenant_id"
   AND book."id" = item."book_id"
  WHERE book."status" = 'published';

  SELECT count(*) INTO pinned_count FROM "_document_book_version_pins";
  IF pinned_count <> expected_count THEN
    RAISE EXCEPTION
      'Document book snapshot cutover blocked: % published item(s), but only % have a published version',
      expected_count, pinned_count;
  END IF;

  SELECT count(*)
  INTO unreadable_count
  FROM "_document_book_version_pins" AS pin
  JOIN "document_versions" AS version
    ON version."tenant_id" = pin."tenant_id"
   AND version."document_id" = pin."document_id"
   AND version."id" = pin."version_id"
  LEFT JOIN "attachments" AS rendered_pdf
    ON rendered_pdf."tenant_id" = version."tenant_id"
   AND rendered_pdf."id" = version."pdf_attachment_id"
  LEFT JOIN "attachments" AS uploaded_pdf
    ON uploaded_pdf."tenant_id" = version."tenant_id"
   AND uploaded_pdf."id" = version."content_attachment_id"
  WHERE NOT (
    (
      rendered_pdf."id" IS NOT NULL
      AND rendered_pdf."content_type" = 'application/pdf'
      AND rendered_pdf."size_bytes" > 0
    )
    OR
    (
      uploaded_pdf."id" IS NOT NULL
      AND uploaded_pdf."content_type" = 'application/pdf'
      AND uploaded_pdf."size_bytes" > 0
    )
  );
  IF unreadable_count > 0 THEN
    RAISE EXCEPTION
      'Document book snapshot cutover blocked: % published item version(s) have no readable non-empty PDF artifact',
      unreadable_count;
  END IF;
END
$$;--> statement-breakpoint

UPDATE "document_book_items" AS item
SET "document_version_id" = pin."version_id",
    "updated_at" = now()
FROM "_document_book_version_pins" AS pin
WHERE pin."item_id" = item."id";--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*)
  INTO violation_count
  FROM "document_book_items" AS item
  JOIN "document_books" AS book
    ON book."tenant_id" = item."tenant_id"
   AND book."id" = item."book_id"
  WHERE (book."status" = 'published' AND item."document_version_id" IS NULL)
     OR (book."status" = 'draft' AND item."document_version_id" IS NOT NULL);
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document book snapshot verification failed: % item(s) have an invalid draft/published pin state',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_books" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_book_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_acknowledgment_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_acknowledgments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Referenced composite keys must exist before PostgreSQL can install the new
-- tenant/document/version foreign keys (the generated order is not sufficient).
CREATE UNIQUE INDEX "document_versions_tenant_document_id_ux"
  ON "document_versions" USING btree ("tenant_id", "document_id", "id");--> statement-breakpoint
CREATE INDEX "document_ack_sessions_tenant_doc_version_idx"
  ON "document_acknowledgment_sessions" USING btree ("tenant_id", "document_id", "version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_ack_sessions_tenant_doc_version_id_ux"
  ON "document_acknowledgment_sessions" USING btree ("tenant_id", "document_id", "version_id", "id");--> statement-breakpoint
CREATE INDEX "document_acks_tenant_doc_version_session_idx"
  ON "document_acknowledgments" USING btree ("tenant_id", "document_id", "version_id", "session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_acks_tenant_doc_version_person_ux"
  ON "document_acknowledgments" USING btree ("tenant_id", "document_id", "version_id", "person_id");--> statement-breakpoint
CREATE INDEX "document_book_items_document_version_idx"
  ON "document_book_items" USING btree ("tenant_id", "document_id", "document_version_id");--> statement-breakpoint

ALTER TABLE "document_acknowledgment_sessions"
  DROP CONSTRAINT "document_ack_sessions_tenant_version_fk";--> statement-breakpoint
ALTER TABLE "document_acknowledgments"
  DROP CONSTRAINT "document_acks_tenant_version_fk";--> statement-breakpoint
ALTER TABLE "document_acknowledgment_sessions"
  ADD CONSTRAINT "document_ack_sessions_tenant_doc_version_fk"
  FOREIGN KEY ("tenant_id", "document_id", "version_id")
  REFERENCES "public"."document_versions"("tenant_id", "document_id", "id")
  NOT VALID;--> statement-breakpoint
ALTER TABLE "document_acknowledgment_sessions"
  VALIDATE CONSTRAINT "document_ack_sessions_tenant_doc_version_fk";--> statement-breakpoint
ALTER TABLE "document_acknowledgments"
  ADD CONSTRAINT "document_acks_tenant_doc_version_fk"
  FOREIGN KEY ("tenant_id", "document_id", "version_id")
  REFERENCES "public"."document_versions"("tenant_id", "document_id", "id")
  NOT VALID;--> statement-breakpoint
ALTER TABLE "document_acknowledgments"
  VALIDATE CONSTRAINT "document_acks_tenant_doc_version_fk";--> statement-breakpoint
ALTER TABLE "document_acknowledgments"
  ADD CONSTRAINT "document_acks_tenant_doc_version_session_fk"
  FOREIGN KEY ("tenant_id", "document_id", "version_id", "session_id")
  REFERENCES "public"."document_acknowledgment_sessions"("tenant_id", "document_id", "version_id", "id")
  NOT VALID;--> statement-breakpoint
ALTER TABLE "document_acknowledgments"
  VALIDATE CONSTRAINT "document_acks_tenant_doc_version_session_fk";--> statement-breakpoint
ALTER TABLE "document_book_items"
  ADD CONSTRAINT "document_book_items_tenant_doc_version_fk"
  FOREIGN KEY ("tenant_id", "document_id", "document_version_id")
  REFERENCES "public"."document_versions"("tenant_id", "document_id", "id")
  NOT VALID;--> statement-breakpoint
ALTER TABLE "document_book_items"
  VALIDATE CONSTRAINT "document_book_items_tenant_doc_version_fk";

-- Squashed source: packages/db/drizzle/0026_orphan_column_cutover.sql
-- Retire write-only/shadow columns only after proving that no authored intent
-- is lost. Course attachment arrays can be normalized mechanically; embedded
-- assessment JSON and document requirement arrays require an explicit operator
-- reconciliation if any real row still contains them.
ALTER TABLE "attachments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_courses" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_course_files" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_lessons" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_content_items" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*)
  INTO violation_count
  FROM "documents"
  WHERE jsonb_typeof("required_for_role_keys") <> 'array'
     OR jsonb_typeof("required_for_trade_ids") <> 'array';
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document requirement-array retirement blocked: % document(s) contain malformed legacy requirements',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "documents"
  WHERE jsonb_array_length("required_for_role_keys") > 0
     OR jsonb_array_length("required_for_trade_ids") > 0;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document requirement-array retirement blocked: % document(s) contain non-empty or invalid legacy requirements; reconcile them into compliance audiences first',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "training_courses"
  WHERE "assessment" IS NOT NULL
    AND "assessment" <> 'null'::jsonb;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Training course assessment retirement blocked: % course(s) contain an embedded legacy assessment; reconcile them into training_assessment_types first',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "training_courses" AS course
  WHERE jsonb_typeof(course."material_attachment_ids") <> 'array';
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Training course material cutover blocked: % course(s) have a non-array attachment value',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "training_courses" AS course
  WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements(course."material_attachment_ids") AS element
    WHERE jsonb_typeof(element) <> 'string'
       OR (element #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Training course material cutover blocked: % course(s) have a malformed attachment array',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "training_courses" AS course
  CROSS JOIN LATERAL jsonb_array_elements_text(course."material_attachment_ids") AS element(value)
  LEFT JOIN "attachments" AS attachment
    ON attachment."tenant_id" = course."tenant_id"
   AND attachment."id" = element.value::uuid
  WHERE attachment."id" IS NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Training course material cutover blocked: % attachment reference(s) are missing or cross-tenant',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM (
    SELECT course."id", element.value
    FROM "training_courses" AS course
    CROSS JOIN LATERAL jsonb_array_elements_text(course."material_attachment_ids") AS element(value)
    GROUP BY course."id", element.value
    HAVING count(*) > 1
  ) AS duplicate_materials;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Training course material cutover blocked: % course/attachment pair(s) are duplicated',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM (
    SELECT lesson."id"
    FROM "training_lessons" AS lesson
    WHERE jsonb_typeof(lesson."slides") <> 'array'
    UNION ALL
    SELECT item."id"
    FROM "training_content_items" AS item
    WHERE jsonb_typeof(item."slides") <> 'array'
  ) AS malformed_decks;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Training slide retirement blocked: % row(s) contain malformed legacy slide JSON',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM (
    SELECT lesson."id"
    FROM "training_lessons" AS lesson
    WHERE jsonb_array_length(lesson."slides") > 0
      AND lesson."source_attachment_id" IS NULL

    UNION ALL

    SELECT item."id"
    FROM "training_content_items" AS item
    WHERE jsonb_array_length(item."slides") > 0
      AND item."source_attachment_id" IS NULL
  ) AS unsnapshotted_decks;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Training slide retirement blocked: % row(s) contain legacy slide JSON without a canonical PowerPoint master',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM (
    SELECT lesson."id"
    FROM "training_lessons" AS lesson
    LEFT JOIN "attachments" AS attachment
      ON attachment."tenant_id" = lesson."tenant_id"
     AND attachment."id" = lesson."source_attachment_id"
    WHERE jsonb_array_length(lesson."slides") > 0
      AND (
        attachment."id" IS NULL
        OR attachment."kind" <> 'document'
        OR attachment."content_type" <>
          'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        OR attachment."size_bytes" <= 0
        OR attachment."size_bytes" > 1073741824
      )

    UNION ALL

    SELECT item."id"
    FROM "training_content_items" AS item
    LEFT JOIN "attachments" AS attachment
      ON attachment."tenant_id" = item."tenant_id"
     AND attachment."id" = item."source_attachment_id"
    WHERE jsonb_array_length(item."slides") > 0
      AND (
        attachment."id" IS NULL
        OR attachment."kind" <> 'document'
        OR attachment."content_type" <>
          'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        OR attachment."size_bytes" <= 0
        OR attachment."size_bytes" > 1073741824
      )
  ) AS invalid_masters;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Training slide retirement blocked: % legacy deck(s) lack a valid non-empty PowerPoint master',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM (
    SELECT lesson."id", lesson."import_status", lesson."import_error", lesson."source_attachment_id"
    FROM "training_lessons" AS lesson
    WHERE nullif(btrim(lesson."import_error"), '') IS NOT NULL
       OR (
         nullif(btrim(lesson."import_status"), '') IS NOT NULL
         AND lower(btrim(lesson."import_status")) NOT IN ('complete', 'completed', 'success', 'imported')
       )

    UNION ALL

    SELECT item."id", item."import_status", item."import_error", item."source_attachment_id"
    FROM "training_content_items" AS item
    WHERE nullif(btrim(item."import_error"), '') IS NOT NULL
       OR (
         nullif(btrim(item."import_status"), '') IS NOT NULL
         AND lower(btrim(item."import_status")) NOT IN ('complete', 'completed', 'success', 'imported')
       )
  ) AS unresolved_imports;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Training slide retirement blocked: % import row(s) remain failed or incomplete',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM (
    SELECT lesson."id"
    FROM "training_lessons" AS lesson
    WHERE jsonb_typeof(lesson."content_blocks") IS DISTINCT FROM 'array'

    UNION ALL

    SELECT item."id"
    FROM "training_content_items" AS item
    WHERE jsonb_typeof(item."content_blocks") IS DISTINCT FROM 'array'
  ) AS malformed_content_blocks;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Training content-block retirement blocked: % row(s) contain malformed legacy block JSON',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM (
    SELECT lesson."id"
    FROM "training_lessons" AS lesson
    WHERE jsonb_array_length(lesson."content_blocks") > 0
      AND nullif(btrim(lesson."content_html"), '') IS NULL

    UNION ALL

    SELECT item."id"
    FROM "training_content_items" AS item
    WHERE jsonb_array_length(item."content_blocks") > 0
      AND nullif(btrim(item."content_html"), '') IS NULL
  ) AS unconverted_content_blocks;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Training content-block retirement blocked: % row(s) contain authored legacy blocks without canonical HTML',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

INSERT INTO "training_course_files" (
  "id", "tenant_id", "course_id", "attachment_id", "label", "sort_order", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  course."tenant_id",
  course."id",
  material.value::uuid,
  attachment."filename",
  coalesce(existing.max_sort_order, -1) + material.ordinality::integer,
  course."created_at",
  course."updated_at"
FROM "training_courses" AS course
CROSS JOIN LATERAL jsonb_array_elements_text(course."material_attachment_ids")
  WITH ORDINALITY AS material(value, ordinality)
JOIN "attachments" AS attachment
  ON attachment."tenant_id" = course."tenant_id"
 AND attachment."id" = material.value::uuid
LEFT JOIN LATERAL (
  SELECT max(file."sort_order") AS max_sort_order
  FROM "training_course_files" AS file
  WHERE file."tenant_id" = course."tenant_id"
    AND file."course_id" = course."id"
) AS existing ON true
WHERE NOT EXISTS (
  SELECT 1
  FROM "training_course_files" AS file
  WHERE file."tenant_id" = course."tenant_id"
    AND file."course_id" = course."id"
    AND file."attachment_id" = material.value::uuid
);--> statement-breakpoint

DO $$
DECLARE
  expected_count bigint;
  actual_count bigint;
BEGIN
  SELECT count(*)
  INTO expected_count
  FROM "training_courses" AS course
  CROSS JOIN LATERAL jsonb_array_elements_text(course."material_attachment_ids") AS material(value);
  SELECT count(*)
  INTO actual_count
  FROM "training_courses" AS course
  CROSS JOIN LATERAL jsonb_array_elements_text(course."material_attachment_ids") AS material(value)
  WHERE EXISTS (
    SELECT 1
    FROM "training_course_files" AS file
    WHERE file."tenant_id" = course."tenant_id"
      AND file."course_id" = course."id"
      AND file."attachment_id" = material.value::uuid
  );
  IF actual_count <> expected_count THEN
    RAISE EXCEPTION
      'Training course material verification failed: % array item(s), % canonical file item(s)',
      expected_count, actual_count;
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_courses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_course_files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_lessons" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_content_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "training_courses" DROP COLUMN "material_attachment_ids";--> statement-breakpoint
ALTER TABLE "training_courses" DROP COLUMN "assessment";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "required_for_role_keys";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "required_for_trade_ids";--> statement-breakpoint
ALTER TABLE "training_content_items" DROP COLUMN "slides";--> statement-breakpoint
ALTER TABLE "training_content_items" DROP COLUMN "import_status";--> statement-breakpoint
ALTER TABLE "training_content_items" DROP COLUMN "import_error";--> statement-breakpoint
ALTER TABLE "training_content_items" DROP COLUMN "content_blocks";--> statement-breakpoint
ALTER TABLE "training_lessons" DROP COLUMN "slides";--> statement-breakpoint
ALTER TABLE "training_lessons" DROP COLUMN "import_status";--> statement-breakpoint
ALTER TABLE "training_lessons" DROP COLUMN "import_error";--> statement-breakpoint
ALTER TABLE "training_lessons" DROP COLUMN "content_blocks";

-- Squashed source: packages/db/drizzle/0027_document_reference_assertion_cutover.sql
-- The private ETL owns byte-safe conversion of legacy reference PDFs into
-- canonical immutable document versions. The schema migration must never
-- manufacture a second document or copy an unverified object: it proves the
-- ETL conversion is complete, reconciles the category tree, then retires only
-- the obsolete metadata tables.
ALTER TABLE "attachments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_versions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_types" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_categories" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_references" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_reference_types" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_reference_categories" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE TEMP TABLE "_document_reference_cutover_map" (
  "reference_id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "source_pk" text NOT NULL,
  "document_id" uuid NOT NULL
) ON COMMIT DROP;--> statement-breakpoint

CREATE TEMP TABLE "_document_reference_category_map" (
  "legacy_id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "canonical_id" uuid NOT NULL,
  "legacy_parent_id" uuid
) ON COMMIT DROP;--> statement-breakpoint

DO $$
DECLARE
  source_count bigint;
  mapped_count bigint;
  violation_count bigint;
BEGIN
  SELECT count(*) INTO source_count FROM "document_references";
  IF source_count > 0 AND to_regclass('etl.id_map') IS NULL THEN
    RAISE EXCEPTION
      'Document reference retirement blocked: % reference row(s) exist but the private ETL crosswalk is unavailable',
      source_count;
  END IF;

  IF to_regclass('etl.id_map') IS NOT NULL THEN
    EXECUTE $query$
      INSERT INTO "_document_reference_cutover_map" (
        "reference_id", "tenant_id", "source_pk", "document_id"
      )
      SELECT reference."id", reference."tenant_id", reference_map.source_pk, document_map.new_id
      FROM "document_references" AS reference
      JOIN etl.id_map AS reference_map
        ON reference_map.source_db = 'beaconhs'
       AND reference_map.source_table = 'DOCUMENTATIONREFERENCE'
       AND reference_map.new_id = reference."id"
       AND reference_map.tenant_id = reference."tenant_id"
      JOIN etl.id_map AS document_map
        ON document_map.source_db = 'beaconhs'
       AND document_map.source_table = 'DOCUMENTATIONREFERENCE_DOC'
       AND document_map.source_pk = reference_map.source_pk
       AND document_map.entity_type = 'document'
       AND document_map.tenant_id = reference."tenant_id"
    $query$;
  END IF;

  SELECT count(*) INTO mapped_count FROM "_document_reference_cutover_map";
  IF mapped_count <> source_count THEN
    RAISE EXCEPTION
      'Document reference retirement blocked: % legacy reference row(s), but % have a tenant-safe canonical document crosswalk',
      source_count, mapped_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "document_references" AS reference
  LEFT JOIN "attachments" AS attachment
    ON attachment."tenant_id" = reference."tenant_id"
   AND attachment."id" = reference."attachment_id"
  WHERE reference."kind" <> 'attachment'
     OR reference."attachment_id" IS NULL
     OR nullif(btrim(reference."url"), '') IS NOT NULL
     OR nullif(btrim(reference."title"), '') IS NULL
     OR attachment."id" IS NULL
     OR attachment."content_type" <> 'application/pdf'
     OR attachment."size_bytes" <= 0;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document reference retirement blocked: % legacy row(s) are not tenant-owned non-empty uploaded PDFs',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "_document_reference_cutover_map" AS map
  LEFT JOIN "documents" AS document
    ON document."tenant_id" = map."tenant_id"
   AND document."id" = map."document_id"
  WHERE document."id" IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM "document_versions" AS version
       JOIN "attachments" AS attachment
         ON attachment."tenant_id" = version."tenant_id"
        AND attachment."id" = coalesce(version."pdf_attachment_id", version."content_attachment_id")
       WHERE version."tenant_id" = map."tenant_id"
         AND version."document_id" = map."document_id"
         AND version."published_at" IS NOT NULL
         AND attachment."content_type" = 'application/pdf'
         AND attachment."size_bytes" > 0
     );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document reference retirement blocked: % mapped document(s) have no immutable published PDF version',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "document_reference_types" AS legacy_type
  WHERE nullif(btrim(legacy_type."name"), '') IS NULL
     OR (
       SELECT count(*)
       FROM "document_types" AS canonical_type
       WHERE canonical_type."tenant_id" = legacy_type."tenant_id"
         AND lower(btrim(canonical_type."name")) = lower(btrim(legacy_type."name"))
     ) <> 1;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document reference retirement blocked: % legacy type(s) have no unique canonical document type',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "document_reference_categories" AS legacy_category
  WHERE nullif(btrim(legacy_category."name"), '') IS NULL
     OR (
       SELECT count(*)
       FROM "document_categories" AS canonical_category
       WHERE canonical_category."tenant_id" = legacy_category."tenant_id"
         AND lower(btrim(canonical_category."name")) = lower(btrim(legacy_category."name"))
     ) <> 1;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document reference retirement blocked: % legacy category(s) have no unique canonical document category',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "document_reference_categories" AS category
  LEFT JOIN "document_reference_categories" AS parent
    ON parent."tenant_id" = category."tenant_id"
   AND parent."id" = category."parent_id"
  WHERE category."parent_id" IS NOT NULL
    AND parent."id" IS NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document reference retirement blocked: % category row(s) have a missing or cross-tenant parent',
      violation_count;
  END IF;

  WITH RECURSIVE category_walk AS (
    SELECT category."tenant_id", category."id", category."parent_id",
           ARRAY[category."id"]::uuid[] AS path, false AS cycle
    FROM "document_reference_categories" AS category
    UNION ALL
    SELECT parent."tenant_id", parent."id", parent."parent_id",
           walk.path || parent."id", parent."id" = ANY(walk.path)
    FROM category_walk AS walk
    JOIN "document_reference_categories" AS parent
      ON parent."tenant_id" = walk."tenant_id"
     AND parent."id" = walk."parent_id"
    WHERE NOT walk.cycle
  )
  SELECT count(*) INTO violation_count FROM category_walk WHERE cycle;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document reference retirement blocked: % legacy category parent cycle(s) detected',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

INSERT INTO "_document_reference_category_map" (
  "legacy_id", "tenant_id", "canonical_id", "legacy_parent_id"
)
SELECT legacy."id", legacy."tenant_id", canonical."id", legacy."parent_id"
FROM "document_reference_categories" AS legacy
JOIN "document_categories" AS canonical
  ON canonical."tenant_id" = legacy."tenant_id"
 AND lower(btrim(canonical."name")) = lower(btrim(legacy."name"));--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*)
  INTO violation_count
  FROM "_document_reference_category_map" AS map
  JOIN "document_categories" AS canonical ON canonical."id" = map."canonical_id"
  LEFT JOIN "_document_reference_category_map" AS parent_map
    ON parent_map."legacy_id" = map."legacy_parent_id"
  WHERE map."legacy_parent_id" IS NOT NULL
    AND canonical."parent_id" IS NOT NULL
    AND canonical."parent_id" <> parent_map."canonical_id";
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document reference retirement blocked: % canonical category parent(s) conflict with the legacy hierarchy',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "document_references" AS reference
  JOIN "_document_reference_cutover_map" AS map ON map."reference_id" = reference."id"
  JOIN "documents" AS document
    ON document."tenant_id" = map."tenant_id"
   AND document."id" = map."document_id"
  LEFT JOIN "document_reference_types" AS legacy_type
    ON legacy_type."tenant_id" = reference."tenant_id"
   AND legacy_type."id" = reference."type_id"
  LEFT JOIN "document_types" AS canonical_type
    ON canonical_type."tenant_id" = document."tenant_id"
   AND canonical_type."id" = document."type_id"
  LEFT JOIN "document_categories" AS canonical_category
    ON canonical_category."tenant_id" = document."tenant_id"
   AND canonical_category."id" = document."category_id"
  WHERE (reference."type_id" IS NOT NULL AND (
           legacy_type."id" IS NULL
           OR canonical_type."id" IS NULL
           OR lower(btrim(canonical_type."name")) <> lower(btrim(legacy_type."name"))
        ))
     OR (nullif(btrim(reference."category"), '') IS NOT NULL AND (
           canonical_category."id" IS NULL
           OR lower(btrim(canonical_category."name")) <> lower(btrim(reference."category"))
        ));
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document reference retirement blocked: % canonical document(s) do not preserve their legacy type/category classification',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

UPDATE "document_categories" AS canonical
SET "parent_id" = parent_map."canonical_id",
    "updated_at" = greatest(canonical."updated_at", legacy."updated_at")
FROM "_document_reference_category_map" AS map
JOIN "document_reference_categories" AS legacy ON legacy."id" = map."legacy_id"
JOIN "_document_reference_category_map" AS parent_map
  ON parent_map."legacy_id" = map."legacy_parent_id"
WHERE canonical."id" = map."canonical_id"
  AND canonical."tenant_id" = map."tenant_id"
  AND canonical."parent_id" IS DISTINCT FROM parent_map."canonical_id";--> statement-breakpoint

DO $$
DECLARE
  source_count bigint;
  verified_count bigint;
BEGIN
  SELECT count(*) INTO source_count FROM "document_references";
  SELECT count(*)
  INTO verified_count
  FROM "_document_reference_cutover_map" AS map
  JOIN "documents" AS document
    ON document."tenant_id" = map."tenant_id"
   AND document."id" = map."document_id"
  WHERE EXISTS (
    SELECT 1
    FROM "document_versions" AS version
    JOIN "attachments" AS attachment
      ON attachment."tenant_id" = version."tenant_id"
     AND attachment."id" = coalesce(version."pdf_attachment_id", version."content_attachment_id")
    WHERE version."tenant_id" = map."tenant_id"
      AND version."document_id" = map."document_id"
      AND version."published_at" IS NOT NULL
      AND attachment."content_type" = 'application/pdf'
      AND attachment."size_bytes" > 0
  );
  IF verified_count <> source_count THEN
    RAISE EXCEPTION
      'Document reference retirement verification failed: % source row(s), % canonical PDF document(s)',
      source_count, verified_count;
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_references" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_reference_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_reference_categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DROP TABLE "document_references";--> statement-breakpoint
DROP TABLE "document_reference_categories";--> statement-breakpoint
DROP TABLE "document_reference_types";--> statement-breakpoint
DROP TYPE "public"."document_reference_kind";

-- Squashed source: packages/db/drizzle/0028_unified_compliance_assignment_cutover.sql
-- Five retired assignment implementations once authored the same requirement
-- concept independently. Convert every remaining authoring row to the unified
-- compliance engine, prove the tenant/target/audience/provenance relationships,
-- and only then remove the shadow tables. Legacy ETL primary keys are numeric;
-- their stable UUID is etl.id_map.new_id (never source_pk cast to uuid).
ALTER TABLE "form_responses" ADD COLUMN "compliance_obligation_id" uuid;--> statement-breakpoint
ALTER TABLE "training_assessments" ADD COLUMN "compliance_obligation_id" uuid;--> statement-breakpoint

-- Keep the post-cutover relationship explicit for the same integrity manifest
-- consumed by the training schema contract test. It is installed later in
-- this section after the provenance backfill and duplicate preflight.
CREATE TEMP TABLE "training_cutover_relationship_hardening" (
  "relation_name" text NOT NULL,
  "child_table" text NOT NULL,
  "child_column" text NOT NULL,
  "parent_table" text NOT NULL,
  "constraint_name" text NOT NULL,
  "legacy_constraint" text NOT NULL,
  "delete_action" text NOT NULL
) ON COMMIT DROP;--> statement-breakpoint
INSERT INTO "training_cutover_relationship_hardening" VALUES
  ('training_assessments.compliance_obligation', 'training_assessments', 'compliance_obligation_id', 'compliance_obligations', 'training_assessments_tenant_compliance_obligation_fk', 'training_assessments_compliance_obligation_id_compliance_obligations_id_fk', 'no action');--> statement-breakpoint

ALTER TABLE "compliance_obligations" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "compliance_audience" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "compliance_dispatches" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "compliance_status" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_responses" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_assessments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_templates" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_types" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_courses" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_assessment_types" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trades" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "departments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_units" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_users" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_assignments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_assignment_dispatches" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_assignments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_assignment_compliance" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_assignment_dispatches" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_assignments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_assignment_audience" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_audience_assignments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_audience_assignment_targets" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_audience_assignment_records" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_assignments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_assignment_dispatches" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE TEMP TABLE "_legacy_compliance_map" (
  "family" text NOT NULL,
  "legacy_id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL,
  "obligation_id" uuid NOT NULL,
  "source_module" text NOT NULL,
  "local_source_key" text NOT NULL,
  "etl_source_key" text NOT NULL,
  "etl_source_table" text NOT NULL,
  "source_key" text NOT NULL,
  "preserve_canonical" boolean DEFAULT false NOT NULL,
  PRIMARY KEY ("family", "legacy_id"),
  UNIQUE ("obligation_id")
) ON COMMIT DROP;--> statement-breakpoint

INSERT INTO "_legacy_compliance_map" (
  "family", "legacy_id", "tenant_id", "obligation_id", "source_module",
  "local_source_key", "etl_source_key", "etl_source_table", "source_key"
)
SELECT 'inspection', "id", "tenant_id", "id", 'inspection',
       'inspection_assignments', 'beaconhs.INSPECTIONSASSIGNMENT',
       'INSPECTIONSASSIGNMENT', 'inspection_assignments'
FROM "inspection_assignments"
UNION ALL
SELECT 'document', "id", "tenant_id", "id", 'document',
       'document_assignments', 'beaconhs.DOCUMENTATIONASSIGNMENT',
       'DOCUMENTATIONASSIGNMENT', 'document_assignments'
FROM "document_assignments"
UNION ALL
SELECT 'training', "id", "tenant_id", "id", 'training',
       'training_audience_assignments', 'beaconhs.TRAININGAUDIENCEASSIGNMENT',
       'TRAININGAUDIENCEASSIGNMENT', 'training_audience_assignments'
FROM "training_audience_assignments"
UNION ALL
SELECT 'form', "id", "tenant_id", "id", 'form',
       'form_assignments', 'beaconhs.FORMASSIGNMENT',
       'FORMASSIGNMENT', 'form_assignments'
FROM "form_assignments"
UNION ALL
SELECT 'journal', "id", "tenant_id", "id", 'journal',
       'journal_assignments', 'beaconhs.DAILYJOURNALSASSIGNMENT',
       'DAILYJOURNALSASSIGNMENT', 'journal_assignments'
FROM "journal_assignments";--> statement-breakpoint

CREATE TEMP TABLE "_legacy_compliance_etl_sources" (
  "family" text NOT NULL,
  "source_table" text NOT NULL,
  "source_key" text NOT NULL,
  PRIMARY KEY ("family", "source_table")
) ON COMMIT DROP;--> statement-breakpoint

INSERT INTO "_legacy_compliance_etl_sources" ("family", "source_table", "source_key") VALUES
  ('inspection', 'INSPECTIONSASSIGNMENT', 'beaconhs.INSPECTIONSASSIGNMENT'),
  ('document', 'DOCUMENTATIONASSIGNMENT', 'beaconhs.DOCUMENTATIONASSIGNMENT'),
  ('journal', 'DAILYJOURNALSASSIGNMENT', 'beaconhs.DAILYJOURNALSASSIGNMENT'),
  ('training', 'TRAININGASSIGNMENT', 'beaconhs.TRAININGASSIGNMENT'),
  ('training', 'TRAININGSKILLASSIGNMENT', 'beaconhs.TRAININGSKILLASSIGNMENT'),
  ('training', 'QUIZASSIGNMENT', 'beaconhs.QUIZASSIGNMENT');--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  IF to_regclass('etl.id_map') IS NOT NULL THEN
    -- The same crosswalk UUID must identify both the imported shadow row and
    -- the canonical obligation. source_pk is deliberately never interpreted.
    EXECUTE $query$
      SELECT count(*)
      FROM "_legacy_compliance_map" AS map
      JOIN "_legacy_compliance_etl_sources" AS accepted
        ON accepted."family" = map."family"
      JOIN etl.id_map AS identity
        ON identity.source_db = 'beaconhs'
       AND identity.source_table = accepted."source_table"
       AND identity.new_id = map."legacy_id"
      WHERE identity.tenant_id <> map."tenant_id"
    $query$ INTO violation_count;
    IF violation_count > 0 THEN
      RAISE EXCEPTION
        'Compliance assignment cutover blocked: % ETL identity row(s) resolve across tenants',
        violation_count;
    END IF;

    EXECUTE $query$
      SELECT count(*)
      FROM (
        SELECT map."family", map."legacy_id"
        FROM "_legacy_compliance_map" AS map
        JOIN "_legacy_compliance_etl_sources" AS accepted
          ON accepted."family" = map."family"
        JOIN etl.id_map AS identity
          ON identity.source_db = 'beaconhs'
         AND identity.source_table = accepted."source_table"
         AND identity.new_id = map."legacy_id"
         AND identity.tenant_id = map."tenant_id"
        GROUP BY map."family", map."legacy_id"
        HAVING count(*) > 1
      ) AS ambiguous
    $query$ INTO violation_count;
    IF violation_count > 0 THEN
      RAISE EXCEPTION
        'Compliance assignment cutover blocked: % shadow row(s) have multiple accepted ETL identities',
        violation_count;
    END IF;

    EXECUTE $query$
      UPDATE "_legacy_compliance_map" AS map
      SET "source_key" = resolved."source_key",
          "etl_source_key" = resolved."source_key",
          "etl_source_table" = resolved."source_table",
          "source_module" = CASE resolved."source_table"
            WHEN 'TRAININGSKILLASSIGNMENT' THEN 'cert_requirement'
            ELSE map."source_module"
          END
      FROM (
        SELECT map_inner."family", map_inner."legacy_id",
               accepted."source_key", accepted."source_table"
        FROM "_legacy_compliance_map" AS map_inner
        JOIN "_legacy_compliance_etl_sources" AS accepted
          ON accepted."family" = map_inner."family"
        JOIN etl.id_map AS identity
          ON identity.source_db = 'beaconhs'
         AND identity.source_table = accepted."source_table"
         AND identity.new_id = map_inner."legacy_id"
         AND identity.tenant_id = map_inner."tenant_id"
      ) AS resolved
      WHERE resolved."family" = map."family"
        AND resolved."legacy_id" = map."legacy_id"
    $query$;

    UPDATE "_legacy_compliance_map" AS map
    SET "preserve_canonical" = true
    WHERE map."source_key" <> map."local_source_key"
      AND EXISTS (
        SELECT 1
        FROM "compliance_obligations" AS obligation
        WHERE obligation."tenant_id" = map."tenant_id"
          AND obligation."id" = map."obligation_id"
          AND obligation."source_key" = map."source_key"
          AND obligation."source_id" = map."legacy_id"
          AND obligation."source_module"::text = map."source_module"
      );
  END IF;

  SELECT count(*) INTO violation_count
  FROM "_legacy_compliance_map"
  WHERE "etl_source_table" = 'TRAININGSKILLASSIGNMENT'
    AND NOT "preserve_canonical";
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Compliance assignment cutover blocked: % training-skill shadow row(s) lack their canonical ETL obligation',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "_legacy_compliance_map" AS map
  JOIN "compliance_obligations" AS obligation ON obligation."id" = map."obligation_id"
  WHERE obligation."tenant_id" <> map."tenant_id"
     OR obligation."source_module"::text <> map."source_module";
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Compliance assignment cutover blocked: % canonical target UUID(s) are cross-tenant or belong to another module',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "_legacy_compliance_map" AS map
  JOIN "compliance_obligations" AS obligation
    ON obligation."tenant_id" = map."tenant_id"
   AND obligation."source_id" = map."legacy_id"
   AND obligation."source_key" IN (map."local_source_key", map."etl_source_key")
  WHERE obligation."source_module"::text <> map."source_module";
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Compliance assignment cutover blocked: % source identities are attached to the wrong module',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

-- Dispatch rows contain queue/publication state that cannot be reinterpreted
-- without replaying side effects. The retired scanners have been removed and
-- current writers use compliance_dispatches; fail closed if an old ledger was
-- ever used rather than silently dropping or replaying it.
DO $$
DECLARE
  form_count bigint;
  inspection_count bigint;
  journal_count bigint;
BEGIN
  SELECT count(*) INTO form_count FROM "form_assignment_dispatches";
  SELECT count(*) INTO inspection_count FROM "inspection_assignment_dispatches";
  SELECT count(*) INTO journal_count FROM "journal_assignment_dispatches";
  IF form_count + inspection_count + journal_count > 0 THEN
    RAISE EXCEPTION
      'Compliance assignment cutover blocked: legacy dispatch ledgers are not empty (form %, inspection %, journal %)',
      form_count, inspection_count, journal_count;
  END IF;
END
$$;--> statement-breakpoint

-- Validate JSON containers before any set-returning JSON function is called.
-- This ordering is intentional: SQL boolean evaluation is not guaranteed to
-- short-circuit, so a combined type/content predicate is not fail-safe.
DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*) INTO violation_count
  FROM "inspection_assignments"
  WHERE jsonb_typeof("target_role_keys") IS DISTINCT FROM 'array'
     OR jsonb_typeof("target_person_ids") IS DISTINCT FROM 'array'
     OR jsonb_typeof("target_org_unit_ids") IS DISTINCT FROM 'array';
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Inspection assignment cutover blocked: % assignment(s) have malformed audience containers',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "form_assignments"
  WHERE ("target_role_keys" IS NOT NULL AND jsonb_typeof("target_role_keys") <> 'array')
     OR ("target_person_ids" IS NOT NULL AND jsonb_typeof("target_person_ids") <> 'array')
     OR ("target_org_unit_ids" IS NOT NULL AND jsonb_typeof("target_org_unit_ids") <> 'array');
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Form assignment cutover blocked: % assignment(s) have malformed audience containers',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "journal_assignments"
  WHERE jsonb_typeof("audience") IS DISTINCT FROM 'object'
     OR jsonb_typeof("send_to_additional") IS DISTINCT FROM 'object';
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Journal assignment cutover blocked: % assignment(s) have malformed audience/recipient containers',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*) INTO violation_count
  FROM (
    SELECT assignment."id", value
    FROM "inspection_assignments" AS assignment
    CROSS JOIN LATERAL jsonb_array_elements(assignment."target_role_keys") AS value
    UNION ALL
    SELECT assignment."id", value
    FROM "inspection_assignments" AS assignment
    CROSS JOIN LATERAL jsonb_array_elements(assignment."target_person_ids") AS value
    UNION ALL
    SELECT assignment."id", value
    FROM "inspection_assignments" AS assignment
    CROSS JOIN LATERAL jsonb_array_elements(assignment."target_org_unit_ids") AS value
    UNION ALL
    SELECT assignment."id", value
    FROM "form_assignments" AS assignment
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(assignment."target_role_keys", '[]'::jsonb)) AS value
    UNION ALL
    SELECT assignment."id", value
    FROM "form_assignments" AS assignment
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(assignment."target_person_ids", '[]'::jsonb)) AS value
    UNION ALL
    SELECT assignment."id", value
    FROM "form_assignments" AS assignment
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(assignment."target_org_unit_ids", '[]'::jsonb)) AS value
  ) AS audience_values
  WHERE jsonb_typeof(value) <> 'string'
     OR nullif(btrim(value #>> '{}'), '') IS NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Compliance assignment cutover blocked: % inspection/form audience value(s) are not non-empty strings',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "journal_assignments" AS assignment
  CROSS JOIN LATERAL jsonb_object_keys(assignment."audience") AS key
  WHERE key NOT IN ('roleKeys', 'personIds', 'orgUnitIds');
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Journal assignment cutover blocked: % unknown audience key(s) cannot be preserved',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "journal_assignments" AS assignment
  CROSS JOIN LATERAL jsonb_each(assignment."audience") AS member(key, value)
  WHERE jsonb_typeof(member.value) <> 'array';
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Journal assignment cutover blocked: % audience member(s) are not arrays',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "journal_assignments" AS assignment
  CROSS JOIN LATERAL jsonb_each(assignment."audience") AS member(key, value)
  CROSS JOIN LATERAL jsonb_array_elements(member.value) AS audience_value
  WHERE jsonb_typeof(audience_value) <> 'string'
     OR nullif(btrim(audience_value #>> '{}'), '') IS NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Journal assignment cutover blocked: % audience value(s) are not non-empty strings',
      violation_count;
  END IF;

  -- Additional submit recipients have no equivalent on a compliance
  -- obligation. Empty legacy shapes are harmless; any actual recipient must be
  -- explicitly reconciled before retirement.
  SELECT count(*) INTO violation_count
  FROM "journal_assignments"
  WHERE "send_to_additional" NOT IN (
    '{}'::jsonb,
    '{"personIds":[]}'::jsonb,
    '{"emails":[]}'::jsonb,
    '{"personIds":[],"emails":[]}'::jsonb
  );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Journal assignment cutover blocked: % assignment(s) still have additional submit recipients',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "training_audience_assignment_targets"
  WHERE ("kind" = 'person' AND num_nonnulls("person_id", "trade_id", "role_key") <> 1)
     OR ("kind" = 'person' AND "person_id" IS NULL)
     OR ("kind" = 'trade' AND num_nonnulls("person_id", "trade_id", "role_key") <> 1)
     OR ("kind" = 'trade' AND "trade_id" IS NULL)
     OR ("kind" = 'role' AND num_nonnulls("person_id", "trade_id", "role_key") <> 1)
     OR ("kind" = 'role' AND nullif(btrim("role_key"), '') IS NULL)
     OR ("kind" = 'everyone' AND num_nonnulls("person_id", "trade_id", "role_key") <> 0);
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Training assignment cutover blocked: % audience target(s) do not match their discriminator',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "training_audience_assignments" AS assignment
  WHERE (assignment."item_kind" = 'course'
         AND (assignment."course_id" IS NULL OR assignment."assessment_type_id" IS NOT NULL))
     OR (assignment."item_kind" = 'assessment_type'
         AND (assignment."assessment_type_id" IS NULL OR assignment."course_id" IS NOT NULL));
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Training assignment cutover blocked: % assignment target(s) do not match their item kind',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

-- UUID text is validated before casts, then every audience/target/creator is
-- required to resolve inside the same tenant.
DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*) INTO violation_count
  FROM (
    SELECT value
    FROM "inspection_assignments" AS assignment
    CROSS JOIN LATERAL jsonb_array_elements_text(assignment."target_person_ids") AS value
    UNION ALL
    SELECT value
    FROM "inspection_assignments" AS assignment
    CROSS JOIN LATERAL jsonb_array_elements_text(assignment."target_org_unit_ids") AS value
    UNION ALL
    SELECT value
    FROM "form_assignments" AS assignment
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(assignment."target_person_ids", '[]'::jsonb)) AS value
    UNION ALL
    SELECT value
    FROM "form_assignments" AS assignment
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(assignment."target_org_unit_ids", '[]'::jsonb)) AS value
    UNION ALL
    SELECT audience_value
    FROM "journal_assignments" AS assignment
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(assignment."audience" -> 'personIds', '[]'::jsonb)) AS audience_value
    UNION ALL
    SELECT audience_value
    FROM "journal_assignments" AS assignment
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(assignment."audience" -> 'orgUnitIds', '[]'::jsonb)) AS audience_value
  ) AS uuid_values
  WHERE value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Compliance assignment cutover blocked: % audience UUID value(s) are malformed',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "inspection_assignments" AS assignment
  LEFT JOIN "inspection_types" AS target
    ON target."tenant_id" = assignment."tenant_id" AND target."id" = assignment."type_id"
  WHERE target."id" IS NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Inspection assignment cutover blocked: % target type(s) are missing or cross-tenant',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "document_assignments" AS assignment
  LEFT JOIN "documents" AS target
    ON target."tenant_id" = assignment."tenant_id" AND target."id" = assignment."document_id"
  WHERE target."id" IS NULL
     OR (assignment."deleted_at" IS NULL AND target."deleted_at" IS NOT NULL);
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document assignment cutover blocked: % target document(s) are missing, cross-tenant, or deleted while required',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "training_audience_assignments" AS assignment
  LEFT JOIN "training_courses" AS course
    ON course."tenant_id" = assignment."tenant_id" AND course."id" = assignment."course_id"
  LEFT JOIN "training_assessment_types" AS assessment_type
    ON assessment_type."tenant_id" = assignment."tenant_id"
   AND assessment_type."id" = assignment."assessment_type_id"
  WHERE (assignment."item_kind" = 'course' AND course."id" IS NULL)
     OR (assignment."item_kind" = 'assessment_type' AND assessment_type."id" IS NULL)
     OR (assignment."deleted_at" IS NULL AND assignment."item_kind" = 'course'
         AND course."deleted_at" IS NOT NULL)
     OR (assignment."deleted_at" IS NULL AND assignment."item_kind" = 'assessment_type'
         AND assessment_type."deleted_at" IS NOT NULL);
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Training assignment cutover blocked: % target item(s) are missing, cross-tenant, or deleted while required',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "form_assignments" AS assignment
  LEFT JOIN "form_templates" AS target
    ON target."tenant_id" = assignment."tenant_id" AND target."id" = assignment."template_id"
  WHERE target."id" IS NULL OR target."deleted_at" IS NOT NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Form assignment cutover blocked: % target template(s) are missing, cross-tenant, or deleted',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM (
    SELECT assignment."tenant_id", role_key AS entity_key
    FROM "inspection_assignments" AS assignment
    CROSS JOIN LATERAL jsonb_array_elements_text(assignment."target_role_keys") AS role_key
    UNION ALL
    SELECT assignment."tenant_id", role_key
    FROM "form_assignments" AS assignment
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(assignment."target_role_keys", '[]'::jsonb)) AS role_key
    UNION ALL
    SELECT assignment."tenant_id", role_key
    FROM "journal_assignments" AS assignment
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(assignment."audience" -> 'roleKeys', '[]'::jsonb)) AS role_key
    UNION ALL
    SELECT target."tenant_id", target."role_key"
    FROM "training_audience_assignment_targets" AS target
    WHERE target."kind" = 'role'
    UNION ALL
    SELECT audience."tenant_id", audience."entity_key"
    FROM "document_assignment_audience" AS audience
    WHERE audience."type" = 'role'
  ) AS source
  WHERE NOT EXISTS (
    SELECT 1 FROM "roles" AS role
    WHERE role."tenant_id" = source."tenant_id" AND role."key" = source.entity_key
  );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Compliance assignment cutover blocked: % role audience value(s) are missing or cross-tenant',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*) INTO violation_count
  FROM "document_assignment_audience"
  WHERE "type" IN ('person', 'trade', 'department')
    AND "entity_key" !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document assignment cutover blocked: % UUID audience value(s) are malformed',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM (
    SELECT assignment."tenant_id", value::uuid AS entity_id
    FROM "inspection_assignments" AS assignment
    CROSS JOIN LATERAL jsonb_array_elements_text(assignment."target_person_ids") AS value
    UNION ALL
    SELECT assignment."tenant_id", value::uuid
    FROM "form_assignments" AS assignment
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(assignment."target_person_ids", '[]'::jsonb)) AS value
    UNION ALL
    SELECT assignment."tenant_id", value::uuid
    FROM "journal_assignments" AS assignment
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(assignment."audience" -> 'personIds', '[]'::jsonb)) AS value
    UNION ALL
    SELECT target."tenant_id", target."person_id"
    FROM "training_audience_assignment_targets" AS target
    WHERE target."kind" = 'person'
    UNION ALL
    SELECT audience."tenant_id", audience."entity_key"::uuid
    FROM "document_assignment_audience" AS audience
    WHERE audience."type" = 'person'
  ) AS source
  WHERE NOT EXISTS (
    SELECT 1 FROM "people" AS person
    WHERE person."tenant_id" = source."tenant_id" AND person."id" = source.entity_id
  );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Compliance assignment cutover blocked: % person audience value(s) are missing or cross-tenant',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM (
    SELECT assignment."tenant_id", value::uuid AS entity_id
    FROM "inspection_assignments" AS assignment
    CROSS JOIN LATERAL jsonb_array_elements_text(assignment."target_org_unit_ids") AS value
    UNION ALL
    SELECT assignment."tenant_id", value::uuid
    FROM "form_assignments" AS assignment
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(assignment."target_org_unit_ids", '[]'::jsonb)) AS value
    UNION ALL
    SELECT assignment."tenant_id", value::uuid
    FROM "journal_assignments" AS assignment
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(assignment."audience" -> 'orgUnitIds', '[]'::jsonb)) AS value
  ) AS source
  WHERE NOT EXISTS (
    SELECT 1 FROM "org_units" AS org_unit
    WHERE org_unit."tenant_id" = source."tenant_id" AND org_unit."id" = source.entity_id
  );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Compliance assignment cutover blocked: % org-unit audience value(s) are missing or cross-tenant',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM (
    SELECT target."tenant_id", target."trade_id" AS entity_id
    FROM "training_audience_assignment_targets" AS target
    WHERE target."kind" = 'trade'
    UNION ALL
    SELECT audience."tenant_id", audience."entity_key"::uuid
    FROM "document_assignment_audience" AS audience
    WHERE audience."type" = 'trade'
  ) AS source
  WHERE NOT EXISTS (
    SELECT 1 FROM "trades" AS trade
    WHERE trade."tenant_id" = source."tenant_id" AND trade."id" = source.entity_id
  );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Compliance assignment cutover blocked: % trade audience value(s) are missing or cross-tenant',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "document_assignment_audience" AS audience
  WHERE audience."type" = 'department'
    AND NOT EXISTS (
      SELECT 1 FROM "departments" AS department
      WHERE department."tenant_id" = audience."tenant_id"
        AND department."id" = audience."entity_key"::uuid
    );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document assignment cutover blocked: % department audience value(s) are missing or cross-tenant',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "document_assignment_audience" AS audience
  WHERE audience."type" = 'everyone' AND audience."entity_key" NOT IN ('', 'all');
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document assignment cutover blocked: % everyone audience value(s) use an unknown sentinel',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM (
    SELECT assignment."tenant_id", assignment."created_by" AS user_id
    FROM "inspection_assignments" AS assignment
    WHERE assignment."created_by" IS NOT NULL
    UNION ALL
    SELECT assignment."tenant_id", assignment."created_by"
    FROM "form_assignments" AS assignment
    WHERE assignment."created_by" IS NOT NULL
  ) AS creator
  WHERE (SELECT count(*) FROM "tenant_users" AS member
         WHERE member."tenant_id" = creator."tenant_id"
           AND member."user_id" = creator.user_id) <> 1;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Compliance assignment cutover blocked: % legacy creator(s) have no unique tenant membership',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM (
    SELECT assignment."tenant_id", assignment."assigned_by_tenant_user_id" AS member_id
    FROM "document_assignments" AS assignment
    WHERE assignment."assigned_by_tenant_user_id" IS NOT NULL
    UNION ALL
    SELECT assignment."tenant_id", assignment."assigned_by_tenant_user_id"
    FROM "training_audience_assignments" AS assignment
    WHERE assignment."assigned_by_tenant_user_id" IS NOT NULL
    UNION ALL
    SELECT assignment."tenant_id", assignment."created_by_tenant_user_id"
    FROM "journal_assignments" AS assignment
    WHERE assignment."created_by_tenant_user_id" IS NOT NULL
  ) AS creator
  WHERE NOT EXISTS (
    SELECT 1 FROM "tenant_users" AS member
    WHERE member."tenant_id" = creator."tenant_id" AND member."id" = creator.member_id
  );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Compliance assignment cutover blocked: % canonical creator membership(s) are missing or cross-tenant',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "inspection_assignments" AS assignment
  WHERE assignment."target_everybody"
    AND (
      jsonb_array_length(assignment."target_role_keys") > 0
      OR jsonb_array_length(assignment."target_person_ids") > 0
      OR jsonb_array_length(assignment."target_org_unit_ids") > 0
    );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Inspection assignment cutover blocked: % assignment(s) mix everyone with narrower audiences',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "training_audience_assignments" AS assignment
  WHERE EXISTS (
      SELECT 1 FROM "training_audience_assignment_targets" AS target
      WHERE target."tenant_id" = assignment."tenant_id"
        AND target."assignment_id" = assignment."id" AND target."kind" = 'everyone'
    )
    AND EXISTS (
      SELECT 1 FROM "training_audience_assignment_targets" AS target
      WHERE target."tenant_id" = assignment."tenant_id"
        AND target."assignment_id" = assignment."id" AND target."kind" <> 'everyone'
    );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Training assignment cutover blocked: % assignment(s) mix everyone with narrower audiences',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

-- The canonical evaluators require positive quantities, bounded percentages,
-- non-negative offsets, and schedules whose firing interval is unambiguous.
DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*) INTO violation_count
  FROM "inspection_assignments"
  WHERE "quantity_per_period" < 1
     OR "compliant_percentage" < 0 OR "compliant_percentage" > 100
     OR coalesce("due_offset_minutes", 0) < 0;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Inspection assignment cutover blocked: % assignment(s) have invalid quantity, percentage, or due offset',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "journal_assignments"
  WHERE "quantity" < 1
     OR "compliant_percentage" < 0 OR "compliant_percentage" > 100
     OR "due_offset_days" < 0;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Journal assignment cutover blocked: % assignment(s) have invalid quantity, percentage, or due offset',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "training_audience_assignments"
  WHERE "remind_before_days" < 0;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Training assignment cutover blocked: % assignment(s) have a negative reminder offset',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "form_assignments"
  WHERE "mode" <> 'scheduled'
     OR nullif(btrim("cron"), '') IS NULL
     OR coalesce("due_offset_minutes", 0) < 0;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Form assignment cutover blocked: % assignment(s) are not complete scheduled requirements',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM (
    SELECT "frequency"::text AS frequency,
           regexp_replace(btrim("cron"), '[[:space:]]+', ' ', 'g') AS cron
    FROM "inspection_assignments" WHERE nullif(btrim("cron"), '') IS NOT NULL
    UNION ALL
    SELECT "frequency"::text,
           regexp_replace(btrim("cron"), '[[:space:]]+', ' ', 'g')
    FROM "journal_assignments" WHERE nullif(btrim("cron"), '') IS NOT NULL
  ) AS schedule
  WHERE CASE schedule.frequency
    WHEN 'day' THEN schedule.cron !~ '^([0-5]?[0-9]) ([01]?[0-9]|2[0-3]) \* \* \*$'
    WHEN 'week' THEN schedule.cron !~ '^([0-5]?[0-9]) ([01]?[0-9]|2[0-3]) \* \* [0-6]$'
    WHEN 'month' THEN schedule.cron !~ '^([0-5]?[0-9]) ([01]?[0-9]|2[0-3]) ([1-9]|1[0-9]|2[0-8]) \* \*$'
    WHEN 'quarter' THEN schedule.cron !~ '^([0-5]?[0-9]) ([01]?[0-9]|2[0-3]) ([1-9]|1[0-9]|2[0-8]) (\*/3|1,4,7,10) \*$'
    WHEN 'year' THEN schedule.cron !~ '^([0-5]?[0-9]) ([01]?[0-9]|2[0-3]) ([1-9]|1[0-9]|2[0-8]) ([1-9]|1[0-2]) \*$'
    ELSE true
  END;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Compliance assignment cutover blocked: % frequency cron expression(s) do not fire exactly once per cadence',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

-- Arbitrary cron expressions are valid product functionality, but the SQL
-- cutover accepts only the common five-field forms it can prove without
-- invoking application code. The form offset must fit inside the shortest
-- represented interval.
CREATE TEMP TABLE "_legacy_cron_validation" (
  "family" text NOT NULL,
  "legacy_id" uuid NOT NULL,
  "cron" text NOT NULL,
  "due_offset_minutes" integer,
  "minimum_interval_minutes" integer
) ON COMMIT DROP;--> statement-breakpoint

INSERT INTO "_legacy_cron_validation" (
  "family", "legacy_id", "cron", "due_offset_minutes", "minimum_interval_minutes"
)
SELECT source.family, source.legacy_id, source.cron, source.due_offset_minutes,
       CASE
         WHEN source.cron ~ '^([0-5]?[0-9]) \* \* \* \*$' THEN 60
         WHEN source.cron ~ '^([0-5]?[0-9]) ([01]?[0-9]|2[0-3]) \* \* \*$' THEN 1440
         WHEN source.cron ~ '^([0-5]?[0-9]) ([01]?[0-9]|2[0-3]) \* \* [0-6]$' THEN 10080
         WHEN source.cron ~ '^([0-5]?[0-9]) ([01]?[0-9]|2[0-3]) ([1-9]|1[0-9]|2[0-8]) \* \*$' THEN 40320
         WHEN source.cron ~ '^([0-5]?[0-9]) ([01]?[0-9]|2[0-3]) ([1-9]|1[0-9]|2[0-8]) (\*/3|1,4,7,10) \*$' THEN 120960
         WHEN source.cron ~ '^([0-5]?[0-9]) ([01]?[0-9]|2[0-3]) ([1-9]|1[0-9]|2[0-8]) ([1-9]|1[0-2]) \*$' THEN 525600
       END
FROM (
  SELECT 'form'::text AS family, "id" AS legacy_id,
         regexp_replace(btrim("cron"), '[[:space:]]+', ' ', 'g') AS cron,
         "due_offset_minutes"
  FROM "form_assignments"
  UNION ALL
  SELECT 'training', "id",
         regexp_replace(btrim("recurrence_cron"), '[[:space:]]+', ' ', 'g'),
         NULL::integer
  FROM "training_audience_assignments"
  WHERE nullif(btrim("recurrence_cron"), '') IS NOT NULL
) AS source;--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*) INTO violation_count
  FROM "_legacy_cron_validation"
  WHERE "minimum_interval_minutes" IS NULL
     OR coalesce("due_offset_minutes", 0) > "minimum_interval_minutes";
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Compliance assignment cutover blocked: % form/training cron expression(s) are invalid, too complex, or have a due offset beyond the next fire',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

CREATE TEMP TABLE "_legacy_compliance_expected_audience" (
  "tenant_id" uuid NOT NULL,
  "obligation_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "entity_key" text NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  PRIMARY KEY ("tenant_id", "obligation_id", "kind", "entity_key")
) ON COMMIT DROP;--> statement-breakpoint

INSERT INTO "_legacy_compliance_expected_audience"
SELECT assignment."tenant_id", assignment."id", 'everyone', '',
       assignment."created_at", assignment."updated_at"
FROM "inspection_assignments" AS assignment
WHERE assignment."target_everybody"
UNION
SELECT assignment."tenant_id", assignment."id", 'role', role_key,
       assignment."created_at", assignment."updated_at"
FROM "inspection_assignments" AS assignment
CROSS JOIN LATERAL jsonb_array_elements_text(assignment."target_role_keys") AS role_key
WHERE NOT assignment."target_everybody"
UNION
SELECT assignment."tenant_id", assignment."id", 'person', person_id,
       assignment."created_at", assignment."updated_at"
FROM "inspection_assignments" AS assignment
CROSS JOIN LATERAL jsonb_array_elements_text(assignment."target_person_ids") AS person_id
WHERE NOT assignment."target_everybody"
UNION
SELECT assignment."tenant_id", assignment."id", 'org_unit', org_unit_id,
       assignment."created_at", assignment."updated_at"
FROM "inspection_assignments" AS assignment
CROSS JOIN LATERAL jsonb_array_elements_text(assignment."target_org_unit_ids") AS org_unit_id
WHERE NOT assignment."target_everybody";--> statement-breakpoint

INSERT INTO "_legacy_compliance_expected_audience"
SELECT audience."tenant_id", audience."assignment_id",
       audience."type"::text,
       CASE WHEN audience."type" = 'everyone' THEN '' ELSE btrim(audience."entity_key") END,
       audience."created_at", audience."updated_at"
FROM "document_assignment_audience" AS audience
ON CONFLICT ("tenant_id", "obligation_id", "kind", "entity_key")
DO UPDATE SET
  "created_at" = least("_legacy_compliance_expected_audience"."created_at", excluded."created_at"),
  "updated_at" = greatest("_legacy_compliance_expected_audience"."updated_at", excluded."updated_at");--> statement-breakpoint

INSERT INTO "_legacy_compliance_expected_audience"
SELECT target."tenant_id", target."assignment_id", target."kind"::text,
       CASE target."kind"
         WHEN 'everyone' THEN ''
         WHEN 'person' THEN target."person_id"::text
         WHEN 'trade' THEN target."trade_id"::text
         WHEN 'role' THEN btrim(target."role_key")
       END,
       target."created_at", target."updated_at"
FROM "training_audience_assignment_targets" AS target
ON CONFLICT ("tenant_id", "obligation_id", "kind", "entity_key")
DO UPDATE SET
  "created_at" = least("_legacy_compliance_expected_audience"."created_at", excluded."created_at"),
  "updated_at" = greatest("_legacy_compliance_expected_audience"."updated_at", excluded."updated_at");--> statement-breakpoint

INSERT INTO "_legacy_compliance_expected_audience"
SELECT assignment."tenant_id", assignment."id", 'role', role_key,
       assignment."created_at", assignment."updated_at"
FROM "form_assignments" AS assignment
CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(assignment."target_role_keys", '[]'::jsonb)) AS role_key
UNION
SELECT assignment."tenant_id", assignment."id", 'person', person_id,
       assignment."created_at", assignment."updated_at"
FROM "form_assignments" AS assignment
CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(assignment."target_person_ids", '[]'::jsonb)) AS person_id
UNION
SELECT assignment."tenant_id", assignment."id", 'org_unit', org_unit_id,
       assignment."created_at", assignment."updated_at"
FROM "form_assignments" AS assignment
CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(assignment."target_org_unit_ids", '[]'::jsonb)) AS org_unit_id
ON CONFLICT ("tenant_id", "obligation_id", "kind", "entity_key")
DO UPDATE SET
  "created_at" = least("_legacy_compliance_expected_audience"."created_at", excluded."created_at"),
  "updated_at" = greatest("_legacy_compliance_expected_audience"."updated_at", excluded."updated_at");--> statement-breakpoint

INSERT INTO "_legacy_compliance_expected_audience"
SELECT assignment."tenant_id", assignment."id", 'role', role_key,
       assignment."created_at", assignment."updated_at"
FROM "journal_assignments" AS assignment
CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(assignment."audience" -> 'roleKeys', '[]'::jsonb)) AS role_key
UNION
SELECT assignment."tenant_id", assignment."id", 'person', person_id,
       assignment."created_at", assignment."updated_at"
FROM "journal_assignments" AS assignment
CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(assignment."audience" -> 'personIds', '[]'::jsonb)) AS person_id
UNION
SELECT assignment."tenant_id", assignment."id", 'org_unit', org_unit_id,
       assignment."created_at", assignment."updated_at"
FROM "journal_assignments" AS assignment
CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(assignment."audience" -> 'orgUnitIds', '[]'::jsonb)) AS org_unit_id
ON CONFLICT ("tenant_id", "obligation_id", "kind", "entity_key")
DO UPDATE SET
  "created_at" = least("_legacy_compliance_expected_audience"."created_at", excluded."created_at"),
  "updated_at" = greatest("_legacy_compliance_expected_audience"."updated_at", excluded."updated_at");--> statement-breakpoint

INSERT INTO "_legacy_compliance_expected_audience"
SELECT assignment."tenant_id", assignment."id", 'everyone', '',
       assignment."created_at", assignment."updated_at"
FROM "journal_assignments" AS assignment
WHERE NOT EXISTS (
  SELECT 1 FROM "_legacy_compliance_expected_audience" AS expected
  WHERE expected."tenant_id" = assignment."tenant_id"
    AND expected."obligation_id" = assignment."id"
);--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*) INTO violation_count
  FROM "_legacy_compliance_map" AS map
  WHERE NOT map."preserve_canonical"
    AND NOT EXISTS (
    SELECT 1 FROM "_legacy_compliance_expected_audience" AS expected
    WHERE expected."tenant_id" = map."tenant_id"
      AND expected."obligation_id" = map."obligation_id"
  );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Compliance assignment cutover blocked: % non-journal assignment(s) resolve to an empty audience',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

CREATE TEMP TABLE "_legacy_compliance_existing" (
  "family" text NOT NULL,
  "legacy_id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL,
  "obligation_id" uuid NOT NULL,
  "existing_id" uuid NOT NULL,
  PRIMARY KEY ("family", "legacy_id", "existing_id")
) ON COMMIT DROP;--> statement-breakpoint

INSERT INTO "_legacy_compliance_existing"
SELECT map."family", map."legacy_id", map."tenant_id", map."obligation_id", obligation."id"
FROM "_legacy_compliance_map" AS map
JOIN "compliance_obligations" AS obligation
  ON obligation."tenant_id" = map."tenant_id"
 AND (
   obligation."id" = map."obligation_id"
   OR (
     obligation."source_id" = map."legacy_id"
     AND (
       obligation."source_key" IN (map."local_source_key", map."source_key", map."etl_source_key")
       OR EXISTS (
         SELECT 1 FROM "_legacy_compliance_etl_sources" AS accepted
         WHERE accepted."family" = map."family"
           AND accepted."source_key" = obligation."source_key"
       )
     )
   )
 );--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*) INTO violation_count
  FROM "_legacy_compliance_map" AS map
  JOIN "compliance_obligations" AS obligation
    ON obligation."tenant_id" = map."tenant_id" AND obligation."id" = map."obligation_id"
  WHERE obligation."source_key" IS NOT NULL
    AND NOT (
      obligation."source_id" = map."legacy_id"
      AND (
        obligation."source_key" IN (map."local_source_key", map."source_key", map."etl_source_key")
        OR EXISTS (
          SELECT 1 FROM "_legacy_compliance_etl_sources" AS accepted
          WHERE accepted."family" = map."family"
            AND accepted."source_key" = obligation."source_key"
        )
      )
    );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Compliance assignment cutover blocked: % target UUID(s) already belong to another canonical source',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "_legacy_compliance_existing" AS existing
  JOIN "_legacy_compliance_map" AS map
    ON map."family" = existing."family" AND map."legacy_id" = existing."legacy_id"
  JOIN "compliance_obligations" AS obligation ON obligation."id" = existing."existing_id"
  WHERE obligation."subject_kind" <> 'per_person'
     OR obligation."source_module"::text <> map."source_module";
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Compliance assignment cutover blocked: % existing canonical obligation(s) have incompatible module/subject semantics',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "_legacy_compliance_map" AS map
  WHERE map."preserve_canonical"
    AND (
      (SELECT count(*) FROM "_legacy_compliance_existing" AS existing
       WHERE existing."family" = map."family"
         AND existing."legacy_id" = map."legacy_id") <> 1
      OR NOT EXISTS (
        SELECT 1 FROM "compliance_audience" AS audience
        WHERE audience."tenant_id" = map."tenant_id"
          AND audience."obligation_id" = map."obligation_id"
      )
    );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Compliance assignment cutover blocked: % authoritative ETL obligation(s) are duplicated or have no canonical audience',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "_legacy_compliance_map" AS map
  WHERE NOT map."preserve_canonical"
    AND EXISTS (
      SELECT 1 FROM "_legacy_compliance_existing" AS existing
      WHERE existing."family" = map."family" AND existing."legacy_id" = map."legacy_id"
    )
    AND (
      EXISTS (
        SELECT expected."kind", expected."entity_key"
        FROM "_legacy_compliance_expected_audience" AS expected
        WHERE expected."tenant_id" = map."tenant_id"
          AND expected."obligation_id" = map."obligation_id"
        EXCEPT
        SELECT audience."kind"::text, audience."entity_key"
        FROM "_legacy_compliance_existing" AS existing
        JOIN "compliance_audience" AS audience
          ON audience."tenant_id" = existing."tenant_id"
         AND audience."obligation_id" = existing."existing_id"
        WHERE existing."family" = map."family" AND existing."legacy_id" = map."legacy_id"
      )
      OR EXISTS (
        SELECT audience."kind"::text, audience."entity_key"
        FROM "_legacy_compliance_existing" AS existing
        JOIN "compliance_audience" AS audience
          ON audience."tenant_id" = existing."tenant_id"
         AND audience."obligation_id" = existing."existing_id"
        WHERE existing."family" = map."family" AND existing."legacy_id" = map."legacy_id"
        EXCEPT
        SELECT expected."kind", expected."entity_key"
        FROM "_legacy_compliance_expected_audience" AS expected
        WHERE expected."tenant_id" = map."tenant_id"
          AND expected."obligation_id" = map."obligation_id"
      )
    );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Compliance assignment cutover blocked: % existing canonical audience(s) conflict with legacy authored intent',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM (
    SELECT existing."tenant_id", existing."obligation_id", dispatch."occurred_at"
    FROM "_legacy_compliance_existing" AS existing
    JOIN "compliance_dispatches" AS dispatch
      ON dispatch."tenant_id" = existing."tenant_id"
     AND dispatch."obligation_id" = existing."existing_id"
    GROUP BY existing."tenant_id", existing."obligation_id", dispatch."occurred_at"
    HAVING count(*) > 1
  ) AS collision;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Compliance assignment cutover blocked: % canonical dispatch occurrence(s) collide during identity deduplication',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

-- Materialize the deterministic target UUID before moving any canonical
-- history. Placeholders exist only inside this transaction and are immediately
-- replaced by the fully validated source rows below.
INSERT INTO "compliance_obligations" (
  "id", "tenant_id", "source_module", "subject_kind", "title", "status",
  "target_ref", "recurrence", "recurrence_kind", "created_at", "updated_at"
)
SELECT map."obligation_id", map."tenant_id",
       map."source_module"::"public"."compliance_source_module",
       'per_person', 'Validated assignment cutover', 'paused', '{}'::jsonb,
       '{"kind":"event"}'::jsonb, 'event', now(), now()
FROM "_legacy_compliance_map" AS map
WHERE NOT EXISTS (
  SELECT 1 FROM "compliance_obligations" AS obligation
  WHERE obligation."id" = map."obligation_id"
);--> statement-breakpoint

UPDATE "compliance_dispatches" AS dispatch
SET "obligation_id" = existing."obligation_id",
    "updated_at" = now()
FROM "_legacy_compliance_existing" AS existing
WHERE existing."existing_id" <> existing."obligation_id"
  AND dispatch."tenant_id" = existing."tenant_id"
  AND dispatch."obligation_id" = existing."existing_id";--> statement-breakpoint

-- Materialized statuses are derived caches. Invalidate both sides of any
-- identity merge so the canonical scanner rematerializes from module evidence.
DELETE FROM "compliance_status" AS status
USING "_legacy_compliance_map" AS map
WHERE status."tenant_id" = map."tenant_id"
  AND status."obligation_id" = map."obligation_id"
  AND NOT map."preserve_canonical";--> statement-breakpoint
DELETE FROM "compliance_status" AS status
USING "_legacy_compliance_existing" AS existing, "_legacy_compliance_map" AS map
WHERE status."tenant_id" = existing."tenant_id"
  AND status."obligation_id" = existing."existing_id"
  AND map."family" = existing."family"
  AND map."legacy_id" = existing."legacy_id"
  AND NOT map."preserve_canonical";--> statement-breakpoint

DELETE FROM "compliance_audience" AS audience
USING "_legacy_compliance_map" AS map
WHERE audience."tenant_id" = map."tenant_id"
  AND audience."obligation_id" = map."obligation_id"
  AND NOT map."preserve_canonical";--> statement-breakpoint
DELETE FROM "compliance_audience" AS audience
USING "_legacy_compliance_existing" AS existing, "_legacy_compliance_map" AS map
WHERE audience."tenant_id" = existing."tenant_id"
  AND audience."obligation_id" = existing."existing_id"
  AND map."family" = existing."family"
  AND map."legacy_id" = existing."legacy_id"
  AND NOT map."preserve_canonical";--> statement-breakpoint

DELETE FROM "compliance_obligations" AS obligation
USING "_legacy_compliance_existing" AS existing, "_legacy_compliance_map" AS map
WHERE existing."existing_id" <> existing."obligation_id"
  AND obligation."tenant_id" = existing."tenant_id"
  AND obligation."id" = existing."existing_id"
  AND map."family" = existing."family"
  AND map."legacy_id" = existing."legacy_id"
  AND NOT map."preserve_canonical";--> statement-breakpoint

UPDATE "compliance_obligations" AS obligation
SET "source_module" = 'inspection',
    "subject_kind" = 'per_person',
    "title" = inspection_type."name" || ' requirement',
    "notes" = assignment."notes",
    "status" = CASE
      WHEN assignment."deleted_at" IS NOT NULL THEN 'archived'::"public"."compliance_obligation_status"
      WHEN assignment."enabled" THEN 'active'::"public"."compliance_obligation_status"
      ELSE 'paused'::"public"."compliance_obligation_status"
    END,
    "target_ref" = jsonb_build_object('inspectionTypeId', assignment."type_id"),
    "recurrence" = jsonb_strip_nulls(jsonb_build_object(
      'kind', 'frequency',
      'frequency', assignment."frequency"::text,
      'quantity', assignment."quantity_per_period",
      'compliantPercentage', assignment."compliant_percentage",
      'cron', nullif(btrim(assignment."cron"), ''),
      'dueOffsetMinutes', assignment."due_offset_minutes"
    )),
    "recurrence_kind" = 'frequency',
    "last_scanned_at" = coalesce(obligation."last_scanned_at", assignment."last_fired_at"),
    "next_due_at" = coalesce(obligation."next_due_at", assignment."next_due_at"),
    "source_key" = map."source_key",
    "source_id" = map."legacy_id",
    "created_by_tenant_user_id" = (
      SELECT member."id" FROM "tenant_users" AS member
      WHERE member."tenant_id" = assignment."tenant_id"
        AND member."user_id" = assignment."created_by"
    ),
    "created_at" = least(obligation."created_at", assignment."created_at"),
    "updated_at" = greatest(obligation."updated_at", assignment."updated_at"),
    "deleted_at" = assignment."deleted_at"
FROM "inspection_assignments" AS assignment
JOIN "inspection_types" AS inspection_type
  ON inspection_type."tenant_id" = assignment."tenant_id"
 AND inspection_type."id" = assignment."type_id"
JOIN "_legacy_compliance_map" AS map
  ON map."family" = 'inspection' AND map."legacy_id" = assignment."id"
WHERE obligation."tenant_id" = map."tenant_id"
  AND obligation."id" = map."obligation_id"
  AND NOT map."preserve_canonical";--> statement-breakpoint

UPDATE "compliance_obligations" AS obligation
SET "source_module" = 'document',
    "subject_kind" = 'per_person',
    "title" = coalesce(nullif(btrim(assignment."title"), ''), document."title"),
    "notes" = assignment."notes",
    "status" = CASE WHEN assignment."deleted_at" IS NULL
      THEN 'active'::"public"."compliance_obligation_status"
      ELSE 'archived'::"public"."compliance_obligation_status" END,
    "target_ref" = jsonb_build_object('documentId', assignment."document_id"),
    "recurrence" = jsonb_strip_nulls(jsonb_build_object(
      'kind', 'one_time', 'dueOn', assignment."due_on"::text
    )),
    "recurrence_kind" = 'one_time',
    "source_key" = map."source_key",
    "source_id" = map."legacy_id",
    "created_by_tenant_user_id" = assignment."assigned_by_tenant_user_id",
    "created_at" = least(obligation."created_at", assignment."created_at"),
    "updated_at" = greatest(obligation."updated_at", assignment."updated_at"),
    "deleted_at" = assignment."deleted_at"
FROM "document_assignments" AS assignment
JOIN "documents" AS document
  ON document."tenant_id" = assignment."tenant_id"
 AND document."id" = assignment."document_id"
JOIN "_legacy_compliance_map" AS map
  ON map."family" = 'document' AND map."legacy_id" = assignment."id"
WHERE obligation."tenant_id" = map."tenant_id"
  AND obligation."id" = map."obligation_id"
  AND NOT map."preserve_canonical";--> statement-breakpoint

UPDATE "compliance_obligations" AS obligation
SET "source_module" = 'training',
    "subject_kind" = 'per_person',
    "title" = assignment."name",
    "notes" = assignment."notes",
    "status" = CASE
      WHEN assignment."deleted_at" IS NOT NULL OR assignment."status" = 'archived'
        THEN 'archived'::"public"."compliance_obligation_status"
      ELSE 'active'::"public"."compliance_obligation_status"
    END,
    "target_ref" = jsonb_strip_nulls(jsonb_build_object(
      'trainingItemKind', assignment."item_kind"::text,
      'courseId', assignment."course_id",
      'assessmentTypeId', assignment."assessment_type_id"
    )),
    "recurrence" = CASE
      WHEN nullif(btrim(assignment."recurrence_cron"), '') IS NOT NULL THEN
        jsonb_build_object(
          'kind', 'cron',
          'cron', regexp_replace(btrim(assignment."recurrence_cron"), '[[:space:]]+', ' ', 'g'),
          'remindBeforeDays', assignment."remind_before_days"
        )
      ELSE jsonb_strip_nulls(jsonb_build_object(
        'kind', 'one_time',
        'dueOn', assignment."due_on"::text,
        'remindBeforeDays', assignment."remind_before_days"
      ))
    END,
    "recurrence_kind" = CASE
      WHEN nullif(btrim(assignment."recurrence_cron"), '') IS NOT NULL
        THEN 'cron'::"public"."compliance_recurrence_kind"
      ELSE 'one_time'::"public"."compliance_recurrence_kind"
    END,
    "source_key" = map."source_key",
    "source_id" = map."legacy_id",
    "created_by_tenant_user_id" = assignment."assigned_by_tenant_user_id",
    "created_at" = least(obligation."created_at", assignment."created_at"),
    "updated_at" = greatest(obligation."updated_at", assignment."updated_at"),
    "deleted_at" = assignment."deleted_at"
FROM "training_audience_assignments" AS assignment
JOIN "_legacy_compliance_map" AS map
  ON map."family" = 'training' AND map."legacy_id" = assignment."id"
WHERE obligation."tenant_id" = map."tenant_id"
  AND obligation."id" = map."obligation_id"
  AND map."source_module" = 'training'
  AND NOT map."preserve_canonical";--> statement-breakpoint

UPDATE "compliance_obligations" AS obligation
SET "source_module" = 'form',
    "subject_kind" = 'per_person',
    "title" = template."name",
    "notes" = NULL,
    "status" = CASE WHEN assignment."enabled"
      THEN 'active'::"public"."compliance_obligation_status"
      ELSE 'paused'::"public"."compliance_obligation_status" END,
    "target_ref" = jsonb_build_object('formTemplateId', assignment."template_id"),
    "recurrence" = jsonb_strip_nulls(jsonb_build_object(
      'kind', 'cron',
      'cron', regexp_replace(btrim(assignment."cron"), '[[:space:]]+', ' ', 'g'),
      'dueOffsetMinutes', assignment."due_offset_minutes"
    )),
    "recurrence_kind" = 'cron',
    "source_key" = map."source_key",
    "source_id" = map."legacy_id",
    "created_by_tenant_user_id" = (
      SELECT member."id" FROM "tenant_users" AS member
      WHERE member."tenant_id" = assignment."tenant_id"
        AND member."user_id" = assignment."created_by"
    ),
    "created_at" = least(obligation."created_at", assignment."created_at"),
    "updated_at" = greatest(obligation."updated_at", assignment."updated_at"),
    "deleted_at" = NULL
FROM "form_assignments" AS assignment
JOIN "form_templates" AS template
  ON template."tenant_id" = assignment."tenant_id"
 AND template."id" = assignment."template_id"
JOIN "_legacy_compliance_map" AS map
  ON map."family" = 'form' AND map."legacy_id" = assignment."id"
WHERE obligation."tenant_id" = map."tenant_id"
  AND obligation."id" = map."obligation_id"
  AND NOT map."preserve_canonical";--> statement-breakpoint

UPDATE "compliance_obligations" AS obligation
SET "source_module" = 'journal',
    "subject_kind" = 'per_person',
    "title" = assignment."name",
    "notes" = assignment."description",
    "status" = CASE
      WHEN assignment."deleted_at" IS NOT NULL THEN 'archived'::"public"."compliance_obligation_status"
      WHEN assignment."active" THEN 'active'::"public"."compliance_obligation_status"
      ELSE 'paused'::"public"."compliance_obligation_status"
    END,
    "target_ref" = '{}'::jsonb,
    "recurrence" = jsonb_strip_nulls(jsonb_build_object(
      'kind', 'frequency',
      'frequency', assignment."frequency"::text,
      'quantity', assignment."quantity",
      'compliantPercentage', assignment."compliant_percentage",
      'cron', nullif(btrim(assignment."cron"), ''),
      'dueOffsetDays', assignment."due_offset_days"
    )),
    "recurrence_kind" = 'frequency',
    "source_key" = map."source_key",
    "source_id" = map."legacy_id",
    "created_by_tenant_user_id" = assignment."created_by_tenant_user_id",
    "created_at" = least(obligation."created_at", assignment."created_at"),
    "updated_at" = greatest(obligation."updated_at", assignment."updated_at"),
    "deleted_at" = assignment."deleted_at"
FROM "journal_assignments" AS assignment
JOIN "_legacy_compliance_map" AS map
  ON map."family" = 'journal' AND map."legacy_id" = assignment."id"
WHERE obligation."tenant_id" = map."tenant_id"
  AND obligation."id" = map."obligation_id"
  AND NOT map."preserve_canonical";--> statement-breakpoint

INSERT INTO "compliance_audience" (
  "id", "tenant_id", "obligation_id", "kind", "entity_key", "created_at", "updated_at"
)
SELECT gen_random_uuid(), expected."tenant_id", expected."obligation_id",
       expected."kind"::"public"."compliance_audience_kind", expected."entity_key",
       expected."created_at", expected."updated_at"
FROM "_legacy_compliance_expected_audience" AS expected
JOIN "_legacy_compliance_map" AS map
  ON map."tenant_id" = expected."tenant_id"
 AND map."obligation_id" = expected."obligation_id"
 AND NOT map."preserve_canonical"
ON CONFLICT ("tenant_id", "obligation_id", "kind", "entity_key") DO NOTHING;--> statement-breakpoint

DO $$
BEGIN
  IF to_regclass('etl.id_map') IS NOT NULL THEN
    EXECUTE $query$
      UPDATE etl.id_map AS identity
      SET entity_type = 'compliance_obligation', last_synced_at = now()
      FROM "_legacy_compliance_map" AS map
      JOIN "_legacy_compliance_etl_sources" AS accepted
        ON accepted."family" = map."family"
       AND accepted."source_table" = map."etl_source_table"
      WHERE identity.source_db = 'beaconhs'
        AND identity.source_table = accepted."source_table"
        AND identity.new_id = map."legacy_id"
        AND identity.tenant_id = map."tenant_id"
    $query$;
  END IF;
END
$$;--> statement-breakpoint

-- Preserve exact authoring provenance on evidence rows. Matching merely by
-- template or assessment type would let unrelated work satisfy a requirement.
DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*) INTO violation_count
  FROM "form_responses" AS response
  LEFT JOIN "form_assignments" AS assignment
    ON assignment."tenant_id" = response."tenant_id"
   AND assignment."id" = response."assignment_id"
  LEFT JOIN "_legacy_compliance_map" AS map
    ON map."family" = 'form'
   AND map."tenant_id" = response."tenant_id"
   AND map."legacy_id" = response."assignment_id"
  WHERE response."assignment_id" IS NOT NULL
    AND (assignment."id" IS NULL
      OR assignment."template_id" <> response."template_id"
      OR map."obligation_id" IS NULL);
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Form response cutover blocked: % assignment link(s) are unmapped, cross-tenant, or target another template',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "form_responses" AS response
  WHERE response."assignment_id" IS NOT NULL
    AND response."status" IN ('submitted', 'in_review', 'closed', 'non_compliant')
    AND (response."submitted_at" IS NULL OR response."submitted_by" IS NULL OR (
      SELECT count(*)
      FROM "tenant_users" AS member
      JOIN "people" AS person
        ON person."tenant_id" = member."tenant_id"
       AND person."user_id" = member."user_id"
       AND person."status" = 'active'
       AND person."deleted_at" IS NULL
      WHERE member."tenant_id" = response."tenant_id"
        AND member."id" = response."submitted_by"
        AND member."status" = 'active'
    ) <> 1);
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Form response cutover blocked: % finalized assigned response(s) lack timestamp/submitter or a unique active person bridge',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "training_assessments" AS assessment
  LEFT JOIN "training_audience_assignments" AS assignment
    ON assignment."tenant_id" = assessment."tenant_id"
   AND assignment."id" = assessment."assignment_id"
  LEFT JOIN "_legacy_compliance_map" AS map
    ON map."family" = 'training'
   AND map."tenant_id" = assessment."tenant_id"
   AND map."legacy_id" = assessment."assignment_id"
  WHERE assessment."assignment_id" IS NOT NULL
    AND (assignment."id" IS NULL
      OR assignment."item_kind" <> 'assessment_type'
      OR assignment."assessment_type_id" <> assessment."type_id"
      OR map."obligation_id" IS NULL);
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Training assessment cutover blocked: % assignment link(s) are unmapped, cross-tenant, or target another assessment type',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

UPDATE "form_responses" AS response
SET "compliance_obligation_id" = map."obligation_id",
    "updated_at" = greatest(response."updated_at", assignment."updated_at")
FROM "form_assignments" AS assignment
JOIN "_legacy_compliance_map" AS map
  ON map."family" = 'form'
 AND map."tenant_id" = assignment."tenant_id"
 AND map."legacy_id" = assignment."id"
WHERE response."tenant_id" = assignment."tenant_id"
  AND response."assignment_id" = assignment."id";--> statement-breakpoint

UPDATE "training_assessments" AS assessment
SET "compliance_obligation_id" = map."obligation_id",
    "updated_at" = greatest(assessment."updated_at", assignment."updated_at")
FROM "training_audience_assignments" AS assignment
JOIN "_legacy_compliance_map" AS map
  ON map."family" = 'training'
 AND map."tenant_id" = assignment."tenant_id"
 AND map."legacy_id" = assignment."id"
WHERE assessment."tenant_id" = assignment."tenant_id"
  AND assessment."assignment_id" = assignment."id";--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*) INTO violation_count FROM "form_responses"
  WHERE "assignment_id" IS NOT NULL AND "compliance_obligation_id" IS NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Form response cutover verification failed: % legacy assignment link(s) were not preserved',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count FROM "training_assessments"
  WHERE "assignment_id" IS NOT NULL AND "compliance_obligation_id" IS NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Training assessment cutover verification failed: % legacy assignment link(s) were not preserved',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM (
    SELECT "tenant_id", "compliance_obligation_id", "person_id"
    FROM "training_assessments"
    WHERE "compliance_obligation_id" IS NOT NULL
      AND "status" = 'in_progress' AND "deleted_at" IS NULL
    GROUP BY "tenant_id", "compliance_obligation_id", "person_id"
    HAVING count(*) > 1
  ) AS duplicate_attempts;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Training assessment cutover blocked: % active person/obligation attempt group(s) contain duplicates',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

DO $$
DECLARE
  expected_count bigint;
  actual_count bigint;
  violation_count bigint;
BEGIN
  SELECT count(*) INTO expected_count FROM "_legacy_compliance_map";
  SELECT count(*) INTO actual_count
  FROM "_legacy_compliance_map" AS map
  JOIN "compliance_obligations" AS obligation
    ON obligation."tenant_id" = map."tenant_id"
   AND obligation."id" = map."obligation_id"
   AND obligation."source_module"::text = map."source_module"
   AND obligation."subject_kind" = 'per_person'
   AND obligation."source_key" = map."source_key"
   AND obligation."source_id" = map."legacy_id";
  IF actual_count <> expected_count THEN
    RAISE EXCEPTION
      'Compliance assignment cutover verification failed: % legacy assignment(s), % exact canonical identities',
      expected_count, actual_count;
  END IF;

  SELECT count(*) INTO expected_count
  FROM "_legacy_compliance_expected_audience" AS expected
  JOIN "_legacy_compliance_map" AS map
    ON map."tenant_id" = expected."tenant_id"
   AND map."obligation_id" = expected."obligation_id"
  WHERE NOT map."preserve_canonical";
  SELECT count(*) INTO actual_count
  FROM "_legacy_compliance_expected_audience" AS expected
  JOIN "_legacy_compliance_map" AS map
    ON map."tenant_id" = expected."tenant_id"
   AND map."obligation_id" = expected."obligation_id"
   AND NOT map."preserve_canonical"
  JOIN "compliance_audience" AS audience
    ON audience."tenant_id" = expected."tenant_id"
   AND audience."obligation_id" = expected."obligation_id"
   AND audience."kind"::text = expected."kind"
   AND audience."entity_key" = expected."entity_key";
  IF actual_count <> expected_count THEN
    RAISE EXCEPTION
      'Compliance assignment audience verification failed: % expected row(s), % exact canonical row(s)',
      expected_count, actual_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "compliance_audience" AS audience
  JOIN "_legacy_compliance_map" AS map
    ON map."tenant_id" = audience."tenant_id"
   AND map."obligation_id" = audience."obligation_id"
  WHERE NOT map."preserve_canonical"
    AND NOT EXISTS (
    SELECT 1 FROM "_legacy_compliance_expected_audience" AS expected
    WHERE expected."tenant_id" = audience."tenant_id"
      AND expected."obligation_id" = audience."obligation_id"
      AND expected."kind" = audience."kind"::text
      AND expected."entity_key" = audience."entity_key"
  );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Compliance assignment audience verification failed: % unexpected canonical row(s)',
      violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM "compliance_obligations"
  WHERE "source_module"::text IN ('permit', 'lone_worker', 'custom');
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Compliance source enum cutover blocked: % obligation(s) still use unimplemented source modules',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

ALTER TYPE "public"."compliance_source_module" RENAME TO "compliance_source_module_retired";--> statement-breakpoint
CREATE TYPE "public"."compliance_source_module" AS ENUM(
  'inspection', 'document', 'training', 'form', 'journal',
  'cert_requirement', 'equipment_inspection', 'ppe_inspection',
  'job_title_signoff', 'corrective_action', 'hazard_assessment'
);--> statement-breakpoint
ALTER TABLE "compliance_obligations"
  ALTER COLUMN "source_module" TYPE "public"."compliance_source_module"
  USING "source_module"::text::"public"."compliance_source_module";--> statement-breakpoint
DROP TYPE "public"."compliance_source_module_retired";

ALTER TABLE "compliance_obligations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "compliance_audience" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "compliance_dispatches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "compliance_status" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_responses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_assessments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_courses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_assessment_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trades" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "departments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_assignment_dispatches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_assignment_compliance" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_assignment_dispatches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_assignment_audience" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_audience_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_audience_assignment_targets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_audience_assignment_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_assignment_dispatches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Install the canonical evidence links before removing their legacy columns.
ALTER TABLE "form_responses"
  ADD CONSTRAINT "form_responses_tenant_compliance_obligation_fk"
  FOREIGN KEY ("tenant_id", "compliance_obligation_id")
  REFERENCES "public"."compliance_obligations"("tenant_id", "id")
  NOT VALID;--> statement-breakpoint
ALTER TABLE "form_responses"
  VALIDATE CONSTRAINT "form_responses_tenant_compliance_obligation_fk";--> statement-breakpoint
CREATE INDEX "form_responses_compliance_obligation_idx"
  ON "form_responses" USING btree ("tenant_id", "compliance_obligation_id", "submitted_at");--> statement-breakpoint

ALTER TABLE "training_assessments"
  ADD CONSTRAINT "training_assessments_tenant_compliance_obligation_fk"
  FOREIGN KEY ("tenant_id", "compliance_obligation_id")
  REFERENCES "public"."compliance_obligations"("tenant_id", "id")
  NOT VALID;--> statement-breakpoint
ALTER TABLE "training_assessments"
  VALIDATE CONSTRAINT "training_assessments_tenant_compliance_obligation_fk";--> statement-breakpoint
CREATE INDEX "training_assessments_compliance_obligation_idx"
  ON "training_assessments" USING btree ("tenant_id", "compliance_obligation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_assessments_active_compliance_attempt_ux"
  ON "training_assessments" USING btree ("tenant_id", "compliance_obligation_id", "person_id")
  WHERE "training_assessments"."compliance_obligation_id" IS NOT NULL
    AND "training_assessments"."status" = 'in_progress'
    AND "training_assessments"."deleted_at" IS NULL;--> statement-breakpoint

ALTER TABLE "form_responses"
  DROP CONSTRAINT "form_responses_tenant_template_assignment_fk";--> statement-breakpoint
DROP INDEX "form_responses_assignment_idx";--> statement-breakpoint
ALTER TABLE "form_responses" DROP COLUMN "assignment_id";--> statement-breakpoint
ALTER TABLE "training_assessments" DROP COLUMN "assignment_id";--> statement-breakpoint

DROP TABLE "form_assignment_dispatches";--> statement-breakpoint
DROP TABLE "inspection_assignment_compliance";--> statement-breakpoint
DROP TABLE "inspection_assignment_dispatches";--> statement-breakpoint
DROP TABLE "training_audience_assignment_records";--> statement-breakpoint
DROP TABLE "training_audience_assignment_targets";--> statement-breakpoint
DROP TABLE "document_assignment_audience";--> statement-breakpoint
DROP TABLE "journal_assignment_dispatches";--> statement-breakpoint
DROP TABLE "form_assignments";--> statement-breakpoint
DROP TABLE "inspection_assignments";--> statement-breakpoint
DROP TABLE "training_audience_assignments";--> statement-breakpoint
DROP TABLE "document_assignments";--> statement-breakpoint
DROP TABLE "journal_assignments";--> statement-breakpoint

DROP TYPE "public"."form_assignment_mode";--> statement-breakpoint
DROP TYPE "public"."inspection_assignment_frequency";--> statement-breakpoint
DROP TYPE "public"."training_audience_assignment_item_kind";--> statement-breakpoint
DROP TYPE "public"."training_audience_assignment_record_status";--> statement-breakpoint
DROP TYPE "public"."training_audience_assignment_status";--> statement-breakpoint
DROP TYPE "public"."training_audience_assignment_target_kind";--> statement-breakpoint
DROP TYPE "public"."document_assignment_audience_type";--> statement-breakpoint
DROP TYPE "public"."journal_assignment_frequency";

-- Squashed source: packages/db/drizzle/0029_document_review_snapshot_cutover.sql
-- Reviews are evidence about the immutable document version that was actually
-- considered. Backfill only where the historical record identifies one version
-- without guessing, then normalize management-review document selections.
CREATE TYPE "public"."document_review_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint
ALTER TABLE "document_reviews" ADD COLUMN "document_version_id" uuid;--> statement-breakpoint
ALTER TABLE "document_reviews" ADD COLUMN "status" "document_review_status" DEFAULT 'completed' NOT NULL;--> statement-breakpoint

CREATE TABLE "document_management_review_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"management_review_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "document_management_review_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "documents" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_versions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_reviews" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_management_reviews" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_management_review_documents" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- A periodic review is pinned to the latest version that was already
-- published when the review was recorded. Prove both existence and a unique
-- top ordering key before writing any version ID.
DO $$
DECLARE
  violation_count bigint;
  violation_details text;
BEGIN
  SELECT count(*),
         left(coalesce(string_agg(review."id"::text, ', ' ORDER BY review."id"), ''), 2000)
  INTO violation_count, violation_details
  FROM "document_reviews" AS review
  WHERE NOT EXISTS (
    SELECT 1
    FROM "document_versions" AS version
    WHERE version."tenant_id" = review."tenant_id"
      AND version."document_id" = review."document_id"
      AND version."published_at" IS NOT NULL
      AND version."published_at" <= review."reviewed_at"
  );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document review version cutover blocked: % review(s) have no version published by reviewed_at (review IDs: %)',
      violation_count, violation_details;
  END IF;

  WITH top_candidates AS (
    SELECT review."id" AS review_id, version."id" AS version_id
    FROM "document_reviews" AS review
    JOIN "document_versions" AS version
      ON version."tenant_id" = review."tenant_id"
     AND version."document_id" = review."document_id"
     AND version."published_at" IS NOT NULL
     AND version."published_at" <= review."reviewed_at"
    WHERE NOT EXISTS (
      SELECT 1
      FROM "document_versions" AS newer
      WHERE newer."tenant_id" = version."tenant_id"
        AND newer."document_id" = version."document_id"
        AND newer."published_at" IS NOT NULL
        AND newer."published_at" <= review."reviewed_at"
        AND (newer."published_at", newer."version")
          > (version."published_at", version."version")
    )
  ), ambiguous AS (
    SELECT review_id
    FROM top_candidates
    GROUP BY review_id
    HAVING count(*) <> 1
  )
  SELECT count(*),
         left(coalesce(string_agg(review_id::text, ', ' ORDER BY review_id), ''), 2000)
  INTO violation_count, violation_details
  FROM ambiguous;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document review version cutover blocked: % review(s) have an ambiguous latest published_at/version candidate (review IDs: %)',
      violation_count, violation_details;
  END IF;
END
$$;--> statement-breakpoint

CREATE TEMP TABLE "_document_review_version_map" ON COMMIT DROP AS
SELECT DISTINCT ON (review."id")
       review."id" AS review_id,
       version."id" AS version_id
FROM "document_reviews" AS review
JOIN "document_versions" AS version
  ON version."tenant_id" = review."tenant_id"
 AND version."document_id" = review."document_id"
 AND version."published_at" IS NOT NULL
 AND version."published_at" <= review."reviewed_at"
ORDER BY review."id", version."published_at" DESC, version."version" DESC, version."id" DESC;--> statement-breakpoint

UPDATE "document_reviews" AS review
SET "document_version_id" = candidate."version_id"
FROM "_document_review_version_map" AS candidate
WHERE candidate."review_id" = review."id";--> statement-breakpoint

-- Validate the old management-review array in stages before invoking JSON set
-- functions or UUID casts. Duplicate UUIDs are rejected rather than silently
-- collapsed because the migration must account for the exact source payload.
DO $$
DECLARE
  violation_count bigint;
  violation_details text;
BEGIN
  SELECT count(*),
         left(coalesce(string_agg(review."id"::text, ', ' ORDER BY review."id"), ''), 2000)
  INTO violation_count, violation_details
  FROM "document_management_reviews" AS review
  WHERE jsonb_typeof(review."documents_reviewed") IS DISTINCT FROM 'array';
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Management review document cutover blocked: % review(s) have a non-array documents_reviewed payload (review IDs: %)',
      violation_count, violation_details;
  END IF;
END
$$;--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
  violation_details text;
BEGIN
  SELECT count(*),
         left(coalesce(string_agg(source.review_id::text, ', ' ORDER BY source.review_id), ''), 2000)
  INTO violation_count, violation_details
  FROM (
    SELECT DISTINCT review."id" AS review_id
    FROM "document_management_reviews" AS review
    CROSS JOIN LATERAL jsonb_array_elements(review."documents_reviewed") AS element
    WHERE jsonb_typeof(element) <> 'string'
       OR (element #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) AS source;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Management review document cutover blocked: % review(s) contain a non-UUID document value (review IDs: %)',
      violation_count, violation_details;
  END IF;
END
$$;--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
  violation_details text;
BEGIN
  WITH duplicates AS (
    SELECT review."id" AS review_id, element.value::uuid AS document_id
    FROM "document_management_reviews" AS review
    CROSS JOIN LATERAL jsonb_array_elements_text(review."documents_reviewed") AS element(value)
    GROUP BY review."id", element.value::uuid
    HAVING count(*) > 1
  )
  SELECT count(*),
         left(coalesce(string_agg(
           format('%s/%s', review_id, document_id), ', ' ORDER BY review_id, document_id
         ), ''), 2000)
  INTO violation_count, violation_details
  FROM duplicates;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Management review document cutover blocked: % duplicate review/document pair(s) exist (%)',
      violation_count, violation_details;
  END IF;

  WITH source AS (
    SELECT review."id" AS review_id,
           review."tenant_id",
           element.value::uuid AS document_id
    FROM "document_management_reviews" AS review
    CROSS JOIN LATERAL jsonb_array_elements_text(review."documents_reviewed") AS element(value)
  ), invalid AS (
    SELECT source.review_id, source.document_id
    FROM source
    LEFT JOIN "documents" AS document
      ON document."tenant_id" = source.tenant_id
     AND document."id" = source.document_id
    WHERE document."id" IS NULL OR document."deleted_at" IS NOT NULL
  )
  SELECT count(*),
         left(coalesce(string_agg(
           format('%s/%s', review_id, document_id), ', ' ORDER BY review_id, document_id
         ), ''), 2000)
  INTO violation_count, violation_details
  FROM invalid;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Management review document cutover blocked: % review/document relation(s) are missing, cross-tenant, or deleted (%)',
      violation_count, violation_details;
  END IF;

  WITH source AS (
    SELECT review."id" AS review_id,
           review."tenant_id",
           element.value::uuid AS document_id
    FROM "document_management_reviews" AS review
    CROSS JOIN LATERAL jsonb_array_elements_text(review."documents_reviewed") AS element(value)
  ), version_counts AS (
    SELECT source.review_id, source.document_id, count(version."id") AS published_count
    FROM source
    LEFT JOIN "document_versions" AS version
      ON version."tenant_id" = source.tenant_id
     AND version."document_id" = source.document_id
     AND version."published_at" IS NOT NULL
    GROUP BY source.review_id, source.document_id
  ), invalid AS (
    SELECT review_id, document_id, published_count
    FROM version_counts
    WHERE published_count <> 1
  )
  SELECT count(*),
         left(coalesce(string_agg(
           format('%s/%s published=%s', review_id, document_id, published_count),
           ', ' ORDER BY review_id, document_id
         ), ''), 2000)
  INTO violation_count, violation_details
  FROM invalid;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Management review document cutover blocked: % review/document relation(s) do not identify exactly one published version (%)',
      violation_count, violation_details;
  END IF;
END
$$;--> statement-breakpoint

INSERT INTO "document_management_review_documents" (
  "id", "tenant_id", "management_review_id", "document_id",
  "document_version_id", "created_at", "updated_at"
)
SELECT gen_random_uuid(), review."tenant_id", review."id",
       element.value::uuid, version."id", review."created_at", review."updated_at"
FROM "document_management_reviews" AS review
CROSS JOIN LATERAL jsonb_array_elements_text(review."documents_reviewed") AS element(value)
JOIN "document_versions" AS version
  ON version."tenant_id" = review."tenant_id"
 AND version."document_id" = element.value::uuid
 AND version."published_at" IS NOT NULL;--> statement-breakpoint

DO $$
DECLARE
  expected_count bigint;
  actual_count bigint;
BEGIN
  SELECT count(*) INTO expected_count
  FROM "document_management_reviews" AS review
  CROSS JOIN LATERAL jsonb_array_elements_text(review."documents_reviewed");

  SELECT count(*) INTO actual_count
  FROM "document_management_review_documents";

  IF actual_count <> expected_count THEN
    RAISE EXCEPTION
      'Management review document verification failed: % source item(s), % exact version pin(s)',
      expected_count, actual_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "document_management_reviews" AS review
    CROSS JOIN LATERAL jsonb_array_elements_text(review."documents_reviewed") AS element(value)
    JOIN "document_versions" AS version
      ON version."tenant_id" = review."tenant_id"
     AND version."document_id" = element.value::uuid
     AND version."published_at" IS NOT NULL
    LEFT JOIN "document_management_review_documents" AS pin
      ON pin."tenant_id" = review."tenant_id"
     AND pin."management_review_id" = review."id"
     AND pin."document_id" = element.value::uuid
     AND pin."document_version_id" = version."id"
    WHERE pin."id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Management review document verification failed: at least one source relation lacks its exact published version pin';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "document_reviews" AS review
    LEFT JOIN "_document_review_version_map" AS expected
      ON expected."review_id" = review."id"
    WHERE review."document_version_id" IS DISTINCT FROM expected."version_id"
  ) THEN
    RAISE EXCEPTION
      'Document review version verification failed: at least one review does not match its latest version published by reviewed_at';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "document_reviews" AS review
    LEFT JOIN "document_versions" AS version
      ON version."tenant_id" = review."tenant_id"
     AND version."document_id" = review."document_id"
     AND version."id" = review."document_version_id"
    WHERE version."id" IS NULL
      OR version."published_at" IS NULL
      OR version."published_at" > review."reviewed_at"
  ) THEN
    RAISE EXCEPTION
      'Document review version verification failed: at least one exact published version pin is missing or temporally invalid';
  END IF;
END
$$;--> statement-breakpoint

CREATE POLICY "tenant_isolation" ON "document_management_review_documents"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_reviews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_management_reviews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_management_review_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "document_reviews" ALTER COLUMN "document_version_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "document_reviews" ALTER COLUMN "outcome" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "document_reviews_document_version_idx" ON "document_reviews" USING btree ("tenant_id","document_id","document_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_management_reviews_tenant_id_id_ux" ON "document_management_reviews" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "document_management_review_documents_review_idx" ON "document_management_review_documents" USING btree ("tenant_id","management_review_id");--> statement-breakpoint
CREATE INDEX "document_management_review_documents_doc_version_idx" ON "document_management_review_documents" USING btree ("tenant_id","document_id","document_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_management_review_documents_review_doc_ux" ON "document_management_review_documents" USING btree ("tenant_id","management_review_id","document_id");--> statement-breakpoint

ALTER TABLE "document_management_review_documents"
  ADD CONSTRAINT "document_management_review_documents_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION NOT VALID;--> statement-breakpoint
ALTER TABLE "document_management_review_documents"
  VALIDATE CONSTRAINT "document_management_review_documents_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "document_reviews"
  ADD CONSTRAINT "document_reviews_tenant_doc_version_fk"
  FOREIGN KEY ("tenant_id", "document_id", "document_version_id")
  REFERENCES "public"."document_versions"("tenant_id", "document_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID;--> statement-breakpoint
ALTER TABLE "document_reviews"
  VALIDATE CONSTRAINT "document_reviews_tenant_doc_version_fk";--> statement-breakpoint
ALTER TABLE "document_management_review_documents"
  ADD CONSTRAINT "document_management_review_documents_tenant_review_fk"
  FOREIGN KEY ("tenant_id", "management_review_id")
  REFERENCES "public"."document_management_reviews"("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION NOT VALID;--> statement-breakpoint
ALTER TABLE "document_management_review_documents"
  VALIDATE CONSTRAINT "document_management_review_documents_tenant_review_fk";--> statement-breakpoint
ALTER TABLE "document_management_review_documents"
  ADD CONSTRAINT "document_management_review_documents_tenant_document_fk"
  FOREIGN KEY ("tenant_id", "document_id")
  REFERENCES "public"."documents"("tenant_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID;--> statement-breakpoint
ALTER TABLE "document_management_review_documents"
  VALIDATE CONSTRAINT "document_management_review_documents_tenant_document_fk";--> statement-breakpoint
ALTER TABLE "document_management_review_documents"
  ADD CONSTRAINT "document_management_review_documents_tenant_doc_version_fk"
  FOREIGN KEY ("tenant_id", "document_id", "document_version_id")
  REFERENCES "public"."document_versions"("tenant_id", "document_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID;--> statement-breakpoint
ALTER TABLE "document_management_review_documents"
  VALIDATE CONSTRAINT "document_management_review_documents_tenant_doc_version_fk";--> statement-breakpoint

ALTER TABLE "document_management_reviews" DROP COLUMN "documents_reviewed";

-- Squashed source: packages/db/drizzle/0030_inspection_configured_response_cutover.sql
-- Configured choice, text, long-text, and number criteria extend the existing
-- response model instead of creating a parallel question subsystem. Rebuild
-- the enum because Drizzle
-- executes all pending migrations in one transaction and PostgreSQL does not
-- allow a value added with ALTER TYPE ... ADD VALUE to be used until commit.
DO $$
DECLARE
  existing_labels text[];
BEGIN
  SELECT array_agg(enum_value."enumlabel"::text ORDER BY enum_value."enumsortorder")
  INTO existing_labels
  FROM pg_type AS enum_type
  JOIN pg_namespace AS enum_namespace
    ON enum_namespace."oid" = enum_type."typnamespace"
  JOIN pg_enum AS enum_value
    ON enum_value."enumtypid" = enum_type."oid"
  WHERE enum_namespace."nspname" = 'public'
    AND enum_type."typname" = 'inspection_bank_response_type';

  IF existing_labels IS DISTINCT FROM ARRAY['pass_fail_na', 'rating', 'yes_no']::text[] THEN
    RAISE EXCEPTION
      'Inspection choice cutover blocked: inspection_bank_response_type has unexpected labels (%)',
      coalesce(array_to_string(existing_labels, ', '), '<missing>');
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "inspection_type_criteria"
  ALTER COLUMN "response_type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "inspection_record_criteria"
  ALTER COLUMN "response_type" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."inspection_bank_response_type"
  RENAME TO "inspection_bank_response_type_retired";--> statement-breakpoint
CREATE TYPE "public"."inspection_bank_response_type"
  AS ENUM('pass_fail_na', 'rating', 'yes_no', 'choice', 'text', 'long_text', 'number');--> statement-breakpoint
ALTER TABLE "inspection_bank_criteria"
  ALTER COLUMN "response_type" TYPE "public"."inspection_bank_response_type"
  USING "response_type"::text::"public"."inspection_bank_response_type";--> statement-breakpoint
ALTER TABLE "inspection_type_criteria"
  ALTER COLUMN "response_type" TYPE "public"."inspection_bank_response_type"
  USING "response_type"::text::"public"."inspection_bank_response_type";--> statement-breakpoint
ALTER TABLE "inspection_record_criteria"
  ALTER COLUMN "response_type" TYPE "public"."inspection_bank_response_type"
  USING "response_type"::text::"public"."inspection_bank_response_type";--> statement-breakpoint
ALTER TABLE "inspection_type_criteria"
  ALTER COLUMN "response_type" SET DEFAULT 'pass_fail_na';--> statement-breakpoint
ALTER TABLE "inspection_record_criteria"
  ALTER COLUMN "response_type" SET DEFAULT 'pass_fail_na';--> statement-breakpoint
DROP TYPE "public"."inspection_bank_response_type_retired";--> statement-breakpoint

ALTER TABLE "inspection_bank_criteria"
  ADD COLUMN "choice_options" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inspection_type_criteria"
  ADD COLUMN "choice_options" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inspection_record_criteria"
  ADD COLUMN "choice_options_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inspection_record_criteria"
  ADD COLUMN "choice_answer" text;--> statement-breakpoint
ALTER TABLE "inspection_record_criteria"
  ADD COLUMN "text_answer" text;--> statement-breakpoint
ALTER TABLE "inspection_record_criteria"
  ADD COLUMN "number_answer" numeric;--> statement-breakpoint

ALTER TABLE "inspection_bank_criteria"
  ADD CONSTRAINT "inspection_bank_criteria_choice_options_ck"
  CHECK (
    (
      "response_type" = 'choice'
      AND jsonb_typeof("choice_options") = 'array'
      AND jsonb_array_length("choice_options") BETWEEN 2 AND 50
    ) OR (
      "response_type" <> 'choice'
      AND "choice_options" = '[]'::jsonb
    )
  ) NOT VALID;--> statement-breakpoint
ALTER TABLE "inspection_bank_criteria"
  VALIDATE CONSTRAINT "inspection_bank_criteria_choice_options_ck";--> statement-breakpoint

ALTER TABLE "inspection_type_criteria"
  ADD CONSTRAINT "inspection_type_criteria_choice_options_ck"
  CHECK (
    (
      "response_type" = 'choice'
      AND jsonb_typeof("choice_options") = 'array'
      AND jsonb_array_length("choice_options") BETWEEN 2 AND 50
    ) OR (
      "response_type" <> 'choice'
      AND "choice_options" = '[]'::jsonb
    )
  ) NOT VALID;--> statement-breakpoint
ALTER TABLE "inspection_type_criteria"
  VALIDATE CONSTRAINT "inspection_type_criteria_choice_options_ck";--> statement-breakpoint

ALTER TABLE "inspection_record_criteria"
  ADD CONSTRAINT "inspection_record_criteria_response_shape_ck"
  CHECK (
    (
      "response_type" = 'choice'
      AND "answer" IS NULL
      AND jsonb_typeof("choice_options_snapshot") = 'array'
      AND jsonb_array_length("choice_options_snapshot") BETWEEN 2 AND 50
      AND (
        "choice_answer" IS NULL
        OR "choice_options_snapshot" ? "choice_answer"
      )
      AND "text_answer" IS NULL
      AND "number_answer" IS NULL
    ) OR (
      "response_type" IN ('text', 'long_text')
      AND "answer" IS NULL
      AND "choice_options_snapshot" = '[]'::jsonb
      AND "choice_answer" IS NULL
      AND "number_answer" IS NULL
    ) OR (
      "response_type" = 'number'
      AND "answer" IS NULL
      AND "choice_options_snapshot" = '[]'::jsonb
      AND "choice_answer" IS NULL
      AND "text_answer" IS NULL
    ) OR (
      "response_type" IN ('pass_fail_na', 'rating', 'yes_no')
      AND "choice_options_snapshot" = '[]'::jsonb
      AND "choice_answer" IS NULL
      AND "text_answer" IS NULL
      AND "number_answer" IS NULL
    )
  ) NOT VALID;--> statement-breakpoint
ALTER TABLE "inspection_record_criteria"
  VALIDATE CONSTRAINT "inspection_record_criteria_response_shape_ck";

-- Squashed source: packages/db/drizzle/0031_identity_access_shadow_cutover.sql
-- Structured title assignments are the sole job-title model. Preserve a
-- nonblank legacy label only for people who do not already have an
-- authoritative primary assignment, then retire the shadow text column.
ALTER TABLE "people" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "departments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trades" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crews" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "person_groups" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "person_titles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "person_title_assignments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_assignments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_connections" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_crosswalk" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_definitions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_schedules" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_runs" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "insight_cards" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "insight_dashboards" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Every runtime writer and the private ETL reconcile these tenant-owned
-- catalogs through one Unicode/case/whitespace-normalized key. Materialize the
-- same key across all tenants so the migration fails before an index or check
-- constraint could discard or ambiguously merge a historical row.
CREATE TEMP TABLE "_identity_catalog_name_preflight" (
  "catalog_name" text NOT NULL,
  "tenant_id" uuid NOT NULL,
  "record_id" uuid NOT NULL,
  "normalized_key" text NOT NULL
) ON COMMIT DROP;--> statement-breakpoint

INSERT INTO "_identity_catalog_name_preflight" (
  "catalog_name", "tenant_id", "record_id", "normalized_key"
)
SELECT 'departments', "tenant_id", "id",
       lower(btrim(regexp_replace(normalize("name", NFKC), '[[:space:]]+', ' ', 'g')))
FROM "departments"
UNION ALL
SELECT 'trades', "tenant_id", "id",
       lower(btrim(regexp_replace(normalize("name", NFKC), '[[:space:]]+', ' ', 'g')))
FROM "trades"
UNION ALL
SELECT 'crews', "tenant_id", "id",
       lower(btrim(regexp_replace(normalize("name", NFKC), '[[:space:]]+', ' ', 'g')))
FROM "crews"
UNION ALL
SELECT 'person_groups', "tenant_id", "id",
       lower(btrim(regexp_replace(normalize("name", NFKC), '[[:space:]]+', ' ', 'g')))
FROM "person_groups"
UNION ALL
SELECT 'person_titles', "tenant_id", "id",
       lower(btrim(regexp_replace(normalize("name", NFKC), '[[:space:]]+', ' ', 'g')))
FROM "person_titles";--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
  violation_details text;
BEGIN
  WITH duplicate_primary AS (
    SELECT "tenant_id", "person_id", count(*) AS assignment_count
    FROM "person_title_assignments"
    WHERE "is_primary" = true
    GROUP BY "tenant_id", "person_id"
    HAVING count(*) > 1
  )
  SELECT count(*),
         left(coalesce(string_agg(
           format('%s/%s=%s', "tenant_id", "person_id", assignment_count),
           ', ' ORDER BY "tenant_id", "person_id"
         ), ''), 2000)
  INTO violation_count, violation_details
  FROM duplicate_primary;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Identity cutover blocked: % person(s) have duplicate primary title assignments (%)',
      violation_count, violation_details;
  END IF;

  SELECT count(*),
         left(coalesce(string_agg(
           format('%s/%s/%s', assignment."tenant_id", assignment."person_id", assignment."title_id"),
           ', ' ORDER BY assignment."tenant_id", assignment."person_id", assignment."title_id"
         ), ''), 2000)
  INTO violation_count, violation_details
  FROM "person_title_assignments" AS assignment
  JOIN "person_titles" AS title
    ON title."tenant_id" = assignment."tenant_id"
   AND title."id" = assignment."title_id"
  WHERE title."deleted_at" IS NOT NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Identity cutover blocked: % title assignment(s) reference an archived title (%)',
      violation_count, violation_details;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM (
    SELECT definition."id"
    FROM "report_definitions" AS definition
    WHERE coalesce(definition."custom_query"::text, '')
      ~* '(^|[^a-zA-Z0-9_])job_title([^a-zA-Z0-9_]|$)'

    UNION ALL

    SELECT schedule."id"
    FROM "report_schedules" AS schedule
    WHERE coalesce(schedule."filters"::text, '')
      ~* '(^|[^a-zA-Z0-9_])job_title([^a-zA-Z0-9_]|$)'

    UNION ALL

    SELECT run."id"
    FROM "report_runs" AS run
    WHERE run."status" IN ('queued', 'running')
      AND coalesce(run."request_snapshot"::text, '')
        ~* '(^|[^a-zA-Z0-9_])job_title([^a-zA-Z0-9_]|$)'

    UNION ALL

    SELECT card."id"
    FROM "insight_cards" AS card
    WHERE coalesce(card."query"::text, '')
          ~* '(^|[^a-zA-Z0-9_])job_title([^a-zA-Z0-9_]|$)'
       OR coalesce(card."viz_settings"::text, '')
          ~* '(^|[^a-zA-Z0-9_])job_title([^a-zA-Z0-9_]|$)'
       OR coalesce(card."config"::text, '')
          ~* '(^|[^a-zA-Z0-9_])job_title([^a-zA-Z0-9_]|$)'

    UNION ALL

    SELECT dashboard."id"
    FROM "insight_dashboards" AS dashboard
    WHERE coalesce(dashboard."layout"::text, '')
          ~* '(^|[^a-zA-Z0-9_])job_title([^a-zA-Z0-9_]|$)'
       OR coalesce(dashboard."params"::text, '')
          ~* '(^|[^a-zA-Z0-9_])job_title([^a-zA-Z0-9_]|$)'
       OR coalesce(dashboard."param_map"::text, '')
          ~* '(^|[^a-zA-Z0-9_])job_title([^a-zA-Z0-9_]|$)'
  ) AS persisted_job_title_reader;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Job title cutover blocked: % persisted report/dashboard definition(s) still reference the retired job_title field',
      violation_count;
  END IF;

  WITH duplicate_role AS (
    SELECT "tenant_id", "tenant_user_id", "role_id", count(*) AS assignment_count
    FROM "role_assignments"
    GROUP BY "tenant_id", "tenant_user_id", "role_id"
    HAVING count(*) > 1
  )
  SELECT count(*),
         left(coalesce(string_agg(
           format('%s/%s/%s=%s', "tenant_id", "tenant_user_id", "role_id", assignment_count),
           ', ' ORDER BY "tenant_id", "tenant_user_id", "role_id"
         ), ''), 2000)
  INTO violation_count, violation_details
  FROM duplicate_role;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Identity cutover blocked: % member/role group(s) contain duplicate assignments (%)',
      violation_count, violation_details;
  END IF;

  SELECT count(*),
         left(coalesce(string_agg(
           format('%s/%s/%s', crosswalk."tenant_id", crosswalk."entity", crosswalk."canonical_id"),
           ', ' ORDER BY crosswalk."tenant_id", crosswalk."entity", crosswalk."canonical_id"
         ), ''), 2000)
  INTO violation_count, violation_details
  FROM "sync_crosswalk" AS crosswalk
  JOIN "sync_connections" AS connection
    ON connection."tenant_id" = crosswalk."tenant_id"
   AND connection."id" = crosswalk."connection_id"
  WHERE connection."deleted_at" IS NOT NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Sync ownership cutover blocked: % crosswalk(s) are still owned by a retired connection (%)',
      violation_count, violation_details;
  END IF;

  WITH duplicate_sync_owner AS (
    SELECT "tenant_id", "entity", "canonical_id", count(*) AS owner_count,
           left(string_agg(
             format('%s/%s', "connection_id", "external_id"),
             ', ' ORDER BY "connection_id", "external_id"
           ), 1000) AS owner_details
    FROM "sync_crosswalk"
    GROUP BY "tenant_id", "entity", "canonical_id"
    HAVING count(*) > 1
  )
  SELECT count(*),
         left(coalesce(string_agg(
           format(
             '%s/%s/%s=%s[%s]',
             "tenant_id", "entity", "canonical_id", owner_count, owner_details
           ),
           ', ' ORDER BY "tenant_id", "entity", "canonical_id"
         ), ''), 2000)
  INTO violation_count, violation_details
  FROM duplicate_sync_owner;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Sync ownership cutover blocked: % tenant/entity/canonical row(s) have multiple authoritative crosswalks (%)',
      violation_count, violation_details;
  END IF;

  SELECT count(*),
         left(coalesce(string_agg(
           format('%s/%s/%s', "catalog_name", "tenant_id", "record_id"),
           ', ' ORDER BY "catalog_name", "tenant_id", "record_id"
         ), ''), 2000)
  INTO violation_count, violation_details
  FROM "_identity_catalog_name_preflight"
  WHERE "normalized_key" = '';
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Identity catalog cutover blocked: % row(s) have blank canonical names (%)',
      violation_count, violation_details;
  END IF;

  WITH duplicate_catalog_name AS (
    SELECT "catalog_name", "tenant_id", "normalized_key", count(*) AS record_count
    FROM "_identity_catalog_name_preflight"
    GROUP BY "catalog_name", "tenant_id", "normalized_key"
    HAVING count(*) > 1
  )
  SELECT count(*),
         left(coalesce(string_agg(
           format(
             '%s/%s/%s=%s',
             "catalog_name", "tenant_id", "normalized_key", record_count
           ),
           ', ' ORDER BY "catalog_name", "tenant_id", "normalized_key"
         ), ''), 2000)
  INTO violation_count, violation_details
  FROM duplicate_catalog_name;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Identity catalog cutover blocked: % catalog/tenant/normalized-name group(s) are ambiguous across active or deleted rows (%)',
      violation_count, violation_details;
  END IF;
END
$$;--> statement-breakpoint

CREATE TEMP TABLE "_legacy_person_title_backfill" (
  "person_id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "display_name" text NOT NULL,
  "normalized_key" text NOT NULL,
  "title_id" uuid
) ON COMMIT DROP;--> statement-breakpoint

INSERT INTO "_legacy_person_title_backfill" (
  "person_id", "tenant_id", "display_name", "normalized_key"
)
SELECT person."id",
       person."tenant_id",
       normalized."display_name",
       lower(normalized."display_name")
FROM "people" AS person
CROSS JOIN LATERAL (
  SELECT btrim(regexp_replace(normalize(person."job_title", NFKC), '[[:space:]]+', ' ', 'g')) AS display_name
) AS normalized
WHERE nullif(normalized."display_name", '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "person_title_assignments" AS assignment
    JOIN "person_titles" AS title
      ON title."tenant_id" = assignment."tenant_id"
     AND title."id" = assignment."title_id"
     AND title."deleted_at" IS NULL
    WHERE assignment."tenant_id" = person."tenant_id"
      AND assignment."person_id" = person."id"
      AND assignment."is_primary" = true
  );--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
  violation_details text;
BEGIN
  SELECT count(*),
         left(coalesce(string_agg(
           format('%s/%s', source."person_id", title."id"),
           ', ' ORDER BY source."person_id", title."id"
         ), ''), 2000)
  INTO violation_count, violation_details
  FROM "_legacy_person_title_backfill" AS source
  JOIN "person_titles" AS title
    ON title."tenant_id" = source."tenant_id"
   AND lower(btrim(regexp_replace(normalize(title."name", NFKC), '[[:space:]]+', ' ', 'g'))) = source."normalized_key"
  WHERE title."deleted_at" IS NOT NULL;

  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Job title cutover blocked: % legacy person title(s) resolve only to a deleted catalog row (%)',
      violation_count, violation_details;
  END IF;
END
$$;--> statement-breakpoint

UPDATE "_legacy_person_title_backfill" AS source
SET "title_id" = title."id"
FROM "person_titles" AS title
WHERE title."tenant_id" = source."tenant_id"
  AND title."deleted_at" IS NULL
  AND lower(btrim(regexp_replace(normalize(title."name", NFKC), '[[:space:]]+', ' ', 'g'))) = source."normalized_key";--> statement-breakpoint

INSERT INTO "person_titles" ("tenant_id", "name")
SELECT DISTINCT ON (source."tenant_id", source."normalized_key")
       source."tenant_id", source."display_name"
FROM "_legacy_person_title_backfill" AS source
WHERE source."title_id" IS NULL
ORDER BY source."tenant_id", source."normalized_key", source."display_name", source."person_id";--> statement-breakpoint

UPDATE "_legacy_person_title_backfill" AS source
SET "title_id" = title."id"
FROM "person_titles" AS title
WHERE source."title_id" IS NULL
  AND title."tenant_id" = source."tenant_id"
  AND title."deleted_at" IS NULL
  AND lower(btrim(regexp_replace(normalize(title."name", NFKC), '[[:space:]]+', ' ', 'g'))) = source."normalized_key";--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*)
  INTO violation_count
  FROM "_legacy_person_title_backfill"
  WHERE "title_id" IS NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Job title cutover verification failed: % legacy title value(s) have no canonical catalog row',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

UPDATE "person_title_assignments" AS assignment
SET "is_primary" = true,
    "updated_at" = now()
FROM "_legacy_person_title_backfill" AS source
WHERE assignment."tenant_id" = source."tenant_id"
  AND assignment."person_id" = source."person_id"
  AND assignment."title_id" = source."title_id"
  AND assignment."is_primary" = false;--> statement-breakpoint

INSERT INTO "person_title_assignments" (
  "tenant_id", "title_id", "person_id", "is_primary"
)
SELECT source."tenant_id", source."title_id", source."person_id", true
FROM "_legacy_person_title_backfill" AS source
WHERE NOT EXISTS (
  SELECT 1
  FROM "person_title_assignments" AS assignment
  WHERE assignment."tenant_id" = source."tenant_id"
    AND assignment."person_id" = source."person_id"
    AND assignment."title_id" = source."title_id"
);--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*)
  INTO violation_count
  FROM "_legacy_person_title_backfill" AS source
  LEFT JOIN "person_title_assignments" AS assignment
    ON assignment."tenant_id" = source."tenant_id"
   AND assignment."person_id" = source."person_id"
   AND assignment."title_id" = source."title_id"
   AND assignment."is_primary" = true
  LEFT JOIN "person_titles" AS title
    ON title."tenant_id" = assignment."tenant_id"
   AND title."id" = assignment."title_id"
   AND title."deleted_at" IS NULL
  WHERE assignment."id" IS NULL OR title."id" IS NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Job title cutover verification failed: % preserved legacy value(s) lack their exact primary assignment',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM (
    SELECT "tenant_id", "person_id"
    FROM "person_title_assignments"
    WHERE "is_primary" = true
    GROUP BY "tenant_id", "person_id"
    HAVING count(*) > 1
  ) AS duplicate_primary;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Job title cutover verification failed: % person(s) have multiple primary assignments after backfill',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "people" AS person
  CROSS JOIN LATERAL (
    SELECT btrim(regexp_replace(normalize(person."job_title", NFKC), '[[:space:]]+', ' ', 'g')) AS display_name
  ) AS normalized
  WHERE nullif(normalized."display_name", '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "person_title_assignments" AS assignment
      JOIN "person_titles" AS title
        ON title."tenant_id" = assignment."tenant_id"
       AND title."id" = assignment."title_id"
       AND title."deleted_at" IS NULL
      WHERE assignment."tenant_id" = person."tenant_id"
        AND assignment."person_id" = person."id"
        AND assignment."is_primary" = true
    );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Job title cutover verification failed: % nonblank legacy value(s) remain without a structured primary',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

-- title_ids remains a read-optimized cache, but assignments are authoritative.
-- Rebuild every person deterministically so pre-cutover drift cannot survive.
WITH desired AS (
  SELECT person."tenant_id",
         person."id",
         coalesce(
           jsonb_agg(assignment."title_id" ORDER BY assignment."title_id")
             FILTER (WHERE assignment."id" IS NOT NULL),
           '[]'::jsonb
         ) AS title_ids
  FROM "people" AS person
  LEFT JOIN "person_title_assignments" AS assignment
    ON assignment."tenant_id" = person."tenant_id"
   AND assignment."person_id" = person."id"
  GROUP BY person."tenant_id", person."id"
)
UPDATE "people" AS person
SET "title_ids" = desired.title_ids,
    "updated_at" = now()
FROM desired
WHERE person."tenant_id" = desired."tenant_id"
  AND person."id" = desired."id"
  AND person."title_ids" IS DISTINCT FROM desired.title_ids;--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*)
  INTO violation_count
  FROM "people" AS person
  WHERE person."title_ids" IS DISTINCT FROM (
    SELECT coalesce(jsonb_agg(assignment."title_id" ORDER BY assignment."title_id"), '[]'::jsonb)
    FROM "person_title_assignments" AS assignment
    WHERE assignment."tenant_id" = person."tenant_id"
      AND assignment."person_id" = person."id"
  );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Job title cutover verification failed: % people row(s) have a stale title_ids cache',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

-- Historical title rows have no ownership flag. Preserve every one as
-- manually maintained, then attach a connection only where the sole people
-- crosswalk had synced at or after the current primary assignment changed.
-- This records defensible co-ownership without guessing that historical data
-- was source-only; future sync-created rows can explicitly set false.
ALTER TABLE "person_title_assignments"
  ADD COLUMN "source_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "person_title_assignments"
  ADD COLUMN "is_manually_maintained" boolean DEFAULT true NOT NULL;--> statement-breakpoint

UPDATE "person_title_assignments" AS assignment
SET "source_connection_id" = owner."connection_id"
FROM "sync_crosswalk" AS owner
WHERE owner."tenant_id" = assignment."tenant_id"
  AND owner."entity" = 'people'
  AND owner."canonical_id" = assignment."person_id"
  AND assignment."is_primary" = true
  AND assignment."updated_at" <= owner."last_synced_at"
  AND assignment."source_connection_id" IS NULL;--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*)
  INTO violation_count
  FROM "person_title_assignments" AS assignment
  JOIN "sync_crosswalk" AS owner
    ON owner."tenant_id" = assignment."tenant_id"
   AND owner."entity" = 'people'
   AND owner."canonical_id" = assignment."person_id"
  WHERE assignment."is_primary" = true
    AND assignment."updated_at" <= owner."last_synced_at"
    AND assignment."source_connection_id" IS DISTINCT FROM owner."connection_id";
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Title source-provenance verification failed: % eligible primary assignment(s) were not attached to their exact people connection',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "person_title_assignments" AS assignment
  LEFT JOIN "sync_crosswalk" AS owner
    ON owner."tenant_id" = assignment."tenant_id"
   AND owner."entity" = 'people'
   AND owner."canonical_id" = assignment."person_id"
   AND owner."connection_id" = assignment."source_connection_id"
  WHERE assignment."source_connection_id" IS NOT NULL
    AND owner."id" IS NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Title source-provenance verification failed: % assignment(s) reference a connection that does not own their person crosswalk',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "person_title_assignments"
  WHERE "source_connection_id" IS NOT NULL
    AND (
      "is_primary" IS DISTINCT FROM true
      OR "is_manually_maintained" IS DISTINCT FROM true
    );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Title source-provenance verification failed: % historical assignment(s) are not primary, conservatively co-owned rows',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "people" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "departments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trades" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "person_groups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "person_titles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "person_title_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_crosswalk" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_definitions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_schedules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "insight_cards" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "insight_dashboards" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "departments"
  ADD CONSTRAINT "departments_name_nonblank_ck"
  CHECK (
    lower(btrim(regexp_replace(normalize("name", NFKC), '[[:space:]]+', ' ', 'g'))) <> ''
  ) NOT VALID;--> statement-breakpoint
ALTER TABLE "departments"
  VALIDATE CONSTRAINT "departments_name_nonblank_ck";--> statement-breakpoint
ALTER TABLE "trades"
  ADD CONSTRAINT "trades_name_nonblank_ck"
  CHECK (
    lower(btrim(regexp_replace(normalize("name", NFKC), '[[:space:]]+', ' ', 'g'))) <> ''
  ) NOT VALID;--> statement-breakpoint
ALTER TABLE "trades"
  VALIDATE CONSTRAINT "trades_name_nonblank_ck";--> statement-breakpoint
ALTER TABLE "crews"
  ADD CONSTRAINT "crews_name_nonblank_ck"
  CHECK (
    lower(btrim(regexp_replace(normalize("name", NFKC), '[[:space:]]+', ' ', 'g'))) <> ''
  ) NOT VALID;--> statement-breakpoint
ALTER TABLE "crews"
  VALIDATE CONSTRAINT "crews_name_nonblank_ck";--> statement-breakpoint
ALTER TABLE "person_groups"
  ADD CONSTRAINT "person_groups_name_nonblank_ck"
  CHECK (
    lower(btrim(regexp_replace(normalize("name", NFKC), '[[:space:]]+', ' ', 'g'))) <> ''
  ) NOT VALID;--> statement-breakpoint
ALTER TABLE "person_groups"
  VALIDATE CONSTRAINT "person_groups_name_nonblank_ck";--> statement-breakpoint
ALTER TABLE "person_titles"
  ADD CONSTRAINT "person_titles_name_nonblank_ck"
  CHECK (
    lower(btrim(regexp_replace(normalize("name", NFKC), '[[:space:]]+', ' ', 'g'))) <> ''
  ) NOT VALID;--> statement-breakpoint
ALTER TABLE "person_titles"
  VALIDATE CONSTRAINT "person_titles_name_nonblank_ck";--> statement-breakpoint

DROP INDEX "departments_tenant_name_ux";--> statement-breakpoint
DROP INDEX "person_groups_tenant_name_ux";--> statement-breakpoint
DROP INDEX "person_titles_tenant_name_ux";--> statement-breakpoint
DROP INDEX "sync_crosswalk_canonical_idx";--> statement-breakpoint

CREATE UNIQUE INDEX "departments_tenant_normalized_name_ux"
  ON "departments" USING btree (
    "tenant_id",
    lower(btrim(regexp_replace(normalize("name", NFKC), '[[:space:]]+', ' ', 'g')))
  );--> statement-breakpoint
CREATE UNIQUE INDEX "trades_tenant_normalized_name_ux"
  ON "trades" USING btree (
    "tenant_id",
    lower(btrim(regexp_replace(normalize("name", NFKC), '[[:space:]]+', ' ', 'g')))
  );--> statement-breakpoint
CREATE UNIQUE INDEX "crews_tenant_normalized_name_ux"
  ON "crews" USING btree (
    "tenant_id",
    lower(btrim(regexp_replace(normalize("name", NFKC), '[[:space:]]+', ' ', 'g')))
  );--> statement-breakpoint
CREATE UNIQUE INDEX "person_groups_tenant_normalized_name_ux"
  ON "person_groups" USING btree (
    "tenant_id",
    lower(btrim(regexp_replace(normalize("name", NFKC), '[[:space:]]+', ' ', 'g')))
  );--> statement-breakpoint
CREATE UNIQUE INDEX "person_titles_tenant_normalized_name_ux"
  ON "person_titles" USING btree (
    "tenant_id",
    lower(btrim(regexp_replace(normalize("name", NFKC), '[[:space:]]+', ' ', 'g')))
  );--> statement-breakpoint
CREATE UNIQUE INDEX "person_title_assignments_one_primary_ux"
  ON "person_title_assignments" USING btree ("tenant_id", "person_id")
  WHERE "person_title_assignments"."is_primary" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "role_assignments_tenant_user_role_ux"
  ON "role_assignments" USING btree ("tenant_id", "tenant_user_id", "role_id");--> statement-breakpoint

CREATE UNIQUE INDEX "sync_crosswalk_tenant_entity_canonical_owner_ux"
  ON "sync_crosswalk" USING btree ("tenant_id", "entity", "canonical_id");--> statement-breakpoint
CREATE INDEX "person_title_assignments_source_connection_idx"
  ON "person_title_assignments" USING btree ("tenant_id", "source_connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_title_assignments_source_owner_ux"
  ON "person_title_assignments" USING btree (
    "tenant_id", "person_id", "source_connection_id"
  ) WHERE "source_connection_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "person_title_assignments"
  ADD CONSTRAINT "person_title_assignments_has_owner_ck"
  CHECK (
    "source_connection_id" IS NOT NULL
    OR "is_manually_maintained" = true
  ) NOT VALID;--> statement-breakpoint
ALTER TABLE "person_title_assignments"
  VALIDATE CONSTRAINT "person_title_assignments_has_owner_ck";--> statement-breakpoint
ALTER TABLE "person_title_assignments"
  ADD CONSTRAINT "person_title_assignments_source_primary_ck"
  CHECK (
    "source_connection_id" IS NULL
    OR "is_primary" = true
  ) NOT VALID;--> statement-breakpoint
ALTER TABLE "person_title_assignments"
  VALIDATE CONSTRAINT "person_title_assignments_source_primary_ck";--> statement-breakpoint

ALTER TABLE "person_title_assignments"
  ADD CONSTRAINT "person_title_assignments_tenant_source_connection_fk"
  FOREIGN KEY ("tenant_id", "source_connection_id")
  REFERENCES "public"."sync_connections"("tenant_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID;--> statement-breakpoint
ALTER TABLE "person_title_assignments"
  VALIDATE CONSTRAINT "person_title_assignments_tenant_source_connection_fk";--> statement-breakpoint

-- Replace the migration-generated attachment constraint name/action with the
-- canonical schema contract. Acknowledgments are immutable evidence, so an
-- attachment cannot be detached behind an existing acknowledgment row.
ALTER TABLE "job_title_task_acknowledgments"
  DROP CONSTRAINT "att_tenant_job_title_task_acknowledgments_signature_c4cbdd57";--> statement-breakpoint
ALTER TABLE "job_title_task_acknowledgments"
  ADD CONSTRAINT "job_title_task_acks_tenant_signature_attachment_fk"
  FOREIGN KEY ("tenant_id", "signature_attachment_id")
  REFERENCES "public"."attachments"("tenant_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID;--> statement-breakpoint
ALTER TABLE "job_title_task_acknowledgments"
  VALIDATE CONSTRAINT "job_title_task_acks_tenant_signature_attachment_fk";--> statement-breakpoint

CREATE OR REPLACE FUNCTION "prevent_acknowledged_job_title_task_rewrite"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW."task" IS DISTINCT FROM OLD."task"
    OR NEW."description" IS DISTINCT FROM OLD."description"
  ) AND EXISTS (
    SELECT 1
    FROM "job_title_task_acknowledgments" AS acknowledgment
    WHERE acknowledgment."tenant_id" = OLD."tenant_id"
      AND acknowledgment."task_id" = OLD."id"
  ) THEN
    RAISE EXCEPTION
      'Acknowledged job-title task content is immutable; create a replacement task instead';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER "job_title_tasks_acknowledged_content_guard_trg"
BEFORE UPDATE OF "task", "description" ON "job_title_tasks"
FOR EACH ROW
EXECUTE FUNCTION "prevent_acknowledged_job_title_task_rewrite"();--> statement-breakpoint

ALTER TABLE "people" DROP COLUMN "job_title";--> statement-breakpoint

-- Squashed source: packages/db/drizzle/0032_notification_recipient_shadow_cutover.sql
-- tenant_notification_settings.user_ids is the sole per-category named-user
-- audience. The retired join table survived the original schema baseline even
-- though no runtime reader or writer remained. Merge every historical user
-- into the canonical JSON array, verify exact coverage, then remove the shadow
-- table. New settings rows receive the same role defaults used when no override
-- row exists, so preserving named recipients does not silently suppress the
-- built-in safety/administrator audience.
ALTER TABLE "tenant_notification_recipients" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_notification_settings" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*)
  INTO violation_count
  FROM "tenant_notification_recipients"
  WHERE nullif(btrim("category"), '') IS NULL
     OR nullif(btrim("user_id"), '') IS NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Notification recipient cutover blocked: % legacy row(s) have a blank category or user id',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "tenant_notification_settings" AS settings
  WHERE EXISTS (
    SELECT 1
    FROM "tenant_notification_recipients" AS recipient
    WHERE recipient."tenant_id" = settings."tenant_id"
      AND recipient."category" = settings."category"
  )
    AND jsonb_typeof(settings."user_ids") IS DISTINCT FROM 'array';
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Notification recipient cutover blocked: % canonical setting row(s) have a non-array user_ids value',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "tenant_notification_settings" AS settings
  WHERE EXISTS (
    SELECT 1
    FROM "tenant_notification_recipients" AS recipient
    WHERE recipient."tenant_id" = settings."tenant_id"
      AND recipient."category" = settings."category"
  )
    AND jsonb_typeof(settings."user_ids") = 'array'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(settings."user_ids") AS entry(value)
      WHERE jsonb_typeof(entry.value) IS DISTINCT FROM 'string'
    );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Notification recipient cutover blocked: % canonical setting row(s) contain a non-string user id',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

INSERT INTO "tenant_notification_settings" (
  "tenant_id", "category", "role_keys", "user_ids"
)
SELECT recipient."tenant_id",
       recipient."category",
       CASE recipient."category"
         WHEN 'incident' THEN '["safety_manager", "tenant_admin"]'::jsonb
         WHEN 'ca' THEN '["safety_manager", "tenant_admin"]'::jsonb
         WHEN 'compliance' THEN '["safety_manager", "tenant_admin"]'::jsonb
         WHEN 'equipment' THEN '["safety_manager", "tenant_admin"]'::jsonb
         ELSE '["tenant_admin"]'::jsonb
       END,
       jsonb_agg(DISTINCT recipient."user_id" ORDER BY recipient."user_id")
FROM "tenant_notification_recipients" AS recipient
GROUP BY recipient."tenant_id", recipient."category"
ON CONFLICT ("tenant_id", "category") DO UPDATE
SET "user_ids" = (
      SELECT coalesce(jsonb_agg(merged.user_id ORDER BY merged.user_id), '[]'::jsonb)
      FROM (
        SELECT DISTINCT value AS user_id
        FROM jsonb_array_elements_text(
          "tenant_notification_settings"."user_ids" || EXCLUDED."user_ids"
        ) AS existing(value)
      ) AS merged
    ),
    "updated_at" = now();--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*)
  INTO violation_count
  FROM "tenant_notification_recipients" AS recipient
  LEFT JOIN "tenant_notification_settings" AS settings
    ON settings."tenant_id" = recipient."tenant_id"
   AND settings."category" = recipient."category"
  WHERE settings."id" IS NULL
     OR jsonb_typeof(settings."user_ids") IS DISTINCT FROM 'array'
     OR NOT (settings."user_ids" ? recipient."user_id");

  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Notification recipient cutover verification failed: % legacy row(s) are missing from canonical user_ids',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "tenant_notification_recipients" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_notification_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DROP TABLE "tenant_notification_recipients";

-- Squashed source: packages/db/drizzle/0033_physical_schema_convergence.sql
-- The application schema is already on the canonical models. This final phase
-- proves every superseded physical value has either been normalized above or
-- explicitly migrated by the storage cutover, then removes the historical
-- columns and redundant indexes so a migrated database exactly matches a fresh
-- database built from the current schema.
ALTER TABLE "ca_complete_steps" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "compliance_obligations" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_categories" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_categories" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_types" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "flow_gates" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_response_steps" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_signatures" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incidents" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_records" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integration_export_log" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_title_task_acknowledgments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_runs" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_schedules" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_integrations" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_lesson_progress" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Retired, disabled adapter rows cannot run in the unified automation engine.
-- Preserve a lone legacy key as the canonical display name, then clear it. Any
-- active or ambiguous row remains fail-closed in the preflight below.
UPDATE "tenant_integrations"
SET "name" = btrim("integration_key"),
    "integration_key" = NULL,
    "updated_at" = now()
WHERE nullif(btrim("integration_key"), '') IS NOT NULL
  AND nullif(btrim("name"), '') IS NULL
  AND "enabled" = false
  AND "deleted_at" IS NOT NULL
  AND "trigger_key" IS NULL
  AND "destination_key" IS NULL;--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*)
  INTO violation_count
  FROM (
    SELECT "id" FROM "hazid_assessment_signatures" WHERE "signature_data_url" IS NOT NULL
    UNION ALL
    SELECT "id" FROM "inspection_records" WHERE "customer_signature_data_url" IS NOT NULL
    UNION ALL
    SELECT "id" FROM "form_response_steps" WHERE "signature_data_url" IS NOT NULL
    UNION ALL
    SELECT "id" FROM "flow_gates" WHERE "signature_data_url" IS NOT NULL
    UNION ALL
    SELECT "id" FROM "training_lesson_progress" WHERE "evaluation_signature_data_url" IS NOT NULL
    UNION ALL
    SELECT "id" FROM "job_title_task_acknowledgments" WHERE "signature_data_url" IS NOT NULL
    UNION ALL
    SELECT "id" FROM "ca_complete_steps" WHERE "signature_data_url" IS NOT NULL
  ) AS unmigrated_signature;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Signature storage cutover blocked: % legacy signature value(s) remain; run and verify backfill-signatures-to-storage before migrating',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "compliance_obligations"
  WHERE (
      nullif(btrim("legacy_table"), '') IS NOT NULL
      OR "legacy_id" IS NOT NULL
    )
    AND (
      nullif(btrim("source_key"), '') IS NULL
      OR ("legacy_id" IS NOT NULL AND "source_id" IS DISTINCT FROM "legacy_id")
    );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Compliance legacy-identity cutover blocked: % obligation(s) lack canonical source identity',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "documents" AS document
  LEFT JOIN "document_categories" AS category
    ON category."tenant_id" = document."tenant_id"
   AND category."id" = document."category_id"
  WHERE nullif(btrim(document."category"), '') IS NOT NULL
    AND (
      category."id" IS NULL
      OR category."deleted_at" IS NOT NULL
      OR lower(btrim(category."name")) <> lower(btrim(document."category"))
    );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Document category cutover blocked: % legacy category value(s) conflict with canonical category relationships',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "equipment_types" AS equipment_type
  JOIN "equipment_categories" AS category
    ON category."tenant_id" = equipment_type."tenant_id"
   AND category."id" = equipment_type."category_id"
  WHERE nullif(btrim(equipment_type."category"), '') IS NOT NULL
    AND lower(btrim(category."name")) <> lower(btrim(equipment_type."category"));
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Equipment type category cutover blocked: % legacy value(s) conflict with canonical category relationships',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "equipment_types" AS equipment_type
  WHERE equipment_type."category_id" IS NULL
    AND nullif(btrim(equipment_type."category"), '') IS NOT NULL
    AND regexp_replace(
          regexp_replace(lower(btrim(equipment_type."category")), '[^a-z0-9]+', '-', 'g'),
          '(^-+|-+$)', '', 'g'
        ) = '';
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Equipment type category cutover blocked: % legacy category value(s) cannot produce a nonblank canonical slug',
      violation_count;
  END IF;

  WITH desired AS (
    SELECT DISTINCT equipment_type."tenant_id",
           lower(btrim(equipment_type."category")) AS normalized_name,
           regexp_replace(
             regexp_replace(lower(btrim(equipment_type."category")), '[^a-z0-9]+', '-', 'g'),
             '(^-+|-+$)', '', 'g'
           ) AS slug
    FROM "equipment_types" AS equipment_type
    WHERE equipment_type."category_id" IS NULL
      AND nullif(btrim(equipment_type."category"), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "equipment_categories" AS category
        WHERE category."tenant_id" = equipment_type."tenant_id"
          AND lower(btrim(category."name")) = lower(btrim(equipment_type."category"))
      )
  ), collision AS (
    SELECT desired."tenant_id", desired.slug
    FROM desired
    GROUP BY desired."tenant_id", desired.slug
    HAVING count(*) > 1

    UNION ALL

    SELECT desired."tenant_id", desired.slug
    FROM desired
    JOIN "equipment_categories" AS category
      ON category."tenant_id" = desired."tenant_id"
     AND category."slug" = desired.slug
     AND lower(btrim(category."name")) <> desired.normalized_name
  )
  SELECT count(*) INTO violation_count FROM collision;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Equipment type category cutover blocked: % tenant/slug collision(s) require manual category reconciliation',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "incidents"
  WHERE "classification" <> '{}'::jsonb;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Incident classification cutover blocked: % incident(s) retain non-empty legacy classification JSON',
      violation_count;
  END IF;

  -- Current writers persist only the canonical medical fields. Preserve every
  -- positive legacy signal, while allowing a canonical true value to supersede
  -- a stale legacy false default written before the canonical fields existed.
  SELECT count(*)
  INTO violation_count
  FROM "incidents"
  WHERE ("ems_notified" AND NOT "ems_called")
     OR ("first_aid_received" AND NOT "first_aid_given")
     OR (
       nullif(btrim("treated_at_hospital"), '') IS NOT NULL
       AND (
         nullif(btrim("hospital_name"), '') IS NULL
         OR lower(btrim("hospital_name")) <> lower(btrim("treated_at_hospital"))
       )
     );
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Incident medical-field cutover blocked: % incident(s) conflict with canonical medical fields',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "tenant_integrations"
  WHERE nullif(btrim("integration_key"), '') IS NOT NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Integration-key cutover blocked: % automation row(s) retain an unmapped legacy adapter key',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "integration_export_log"
  WHERE "automation_id" IS NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Integration export cutover blocked: % export row(s) lack a canonical automation id',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "report_schedules"
  WHERE "run_as_tenant_user_id" IS NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Report schedule cutover blocked: % schedule(s) lack an execution identity',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "report_runs"
  WHERE "scheduled_for" IS NULL
     OR "trigger" IS NULL
     OR "request_snapshot" IS NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Report run cutover blocked: % run(s) lack immutable request provenance',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

INSERT INTO "equipment_categories" (
  "tenant_id", "name", "slug", "created_at", "updated_at"
)
SELECT equipment_type."tenant_id",
       min(btrim(equipment_type."category")),
       regexp_replace(
         regexp_replace(lower(btrim(equipment_type."category")), '[^a-z0-9]+', '-', 'g'),
         '(^-+|-+$)', '', 'g'
       ),
       now(),
       now()
FROM "equipment_types" AS equipment_type
WHERE equipment_type."category_id" IS NULL
  AND nullif(btrim(equipment_type."category"), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "equipment_categories" AS category
    WHERE category."tenant_id" = equipment_type."tenant_id"
      AND lower(btrim(category."name")) = lower(btrim(equipment_type."category"))
  )
GROUP BY equipment_type."tenant_id",
         lower(btrim(equipment_type."category")),
         regexp_replace(
           regexp_replace(lower(btrim(equipment_type."category")), '[^a-z0-9]+', '-', 'g'),
           '(^-+|-+$)', '', 'g'
         );--> statement-breakpoint

UPDATE "equipment_types" AS equipment_type
SET "category_id" = category."id",
    "updated_at" = now()
FROM "equipment_categories" AS category
WHERE equipment_type."category_id" IS NULL
  AND nullif(btrim(equipment_type."category"), '') IS NOT NULL
  AND category."tenant_id" = equipment_type."tenant_id"
  AND lower(btrim(category."name")) = lower(btrim(equipment_type."category"));--> statement-breakpoint

DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*)
  INTO violation_count
  FROM "equipment_types"
  WHERE nullif(btrim("category"), '') IS NOT NULL
    AND "category_id" IS NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Equipment type category cutover verification failed: % legacy category value(s) remain unmapped',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "ca_complete_steps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "compliance_obligations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "flow_gates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_response_steps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hazid_assessment_signatures" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incidents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integration_export_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_title_task_acknowledgments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_schedules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_integrations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_lesson_progress" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "integration_export_log" ALTER COLUMN "automation_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "report_runs" ALTER COLUMN "scheduled_for" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "report_runs" ALTER COLUMN "trigger" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "report_runs" ALTER COLUMN "request_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "report_schedules" ALTER COLUMN "run_as_tenant_user_id" SET NOT NULL;--> statement-breakpoint

DROP INDEX "api_keys_hash_idx";--> statement-breakpoint
DROP INDEX "compliance_obligations_legacy_ux";--> statement-breakpoint
DROP INDEX "document_categories_tenant_name_ux";--> statement-breakpoint
DROP INDEX "integration_export_log_key_idx";--> statement-breakpoint
DROP INDEX "report_definitions_slug_ux";--> statement-breakpoint
DROP INDEX "tenant_integrations_tenant_key_ux";--> statement-breakpoint
DROP INDEX "training_certificates_record_idx";--> statement-breakpoint
DROP INDEX "training_certificates_token_idx";--> statement-breakpoint
DROP INDEX "training_skill_certificates_assignment_idx";--> statement-breakpoint
DROP INDEX "training_skill_certificates_token_idx";--> statement-breakpoint

ALTER TABLE "ca_complete_steps" DROP COLUMN "signature_data_url";--> statement-breakpoint
ALTER TABLE "flow_gates" DROP COLUMN "signature_data_url";--> statement-breakpoint
ALTER TABLE "form_response_steps" DROP COLUMN "signature_data_url";--> statement-breakpoint
ALTER TABLE "hazid_assessment_signatures" DROP COLUMN "signature_data_url";--> statement-breakpoint
ALTER TABLE "inspection_records" DROP COLUMN "customer_signature_data_url";--> statement-breakpoint
ALTER TABLE "job_title_task_acknowledgments" DROP COLUMN "signature_data_url";--> statement-breakpoint
ALTER TABLE "training_lesson_progress" DROP COLUMN "evaluation_signature_data_url";--> statement-breakpoint
ALTER TABLE "compliance_obligations" DROP COLUMN "legacy_table";--> statement-breakpoint
ALTER TABLE "compliance_obligations" DROP COLUMN "legacy_id";--> statement-breakpoint
ALTER TABLE "document_books" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "document_books" DROP COLUMN "category";--> statement-breakpoint
ALTER TABLE "document_books" DROP COLUMN "contents";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "category";--> statement-breakpoint
ALTER TABLE "equipment_types" DROP COLUMN "category";--> statement-breakpoint
ALTER TABLE "incidents" DROP COLUMN "classification";--> statement-breakpoint
ALTER TABLE "incidents" DROP COLUMN "ems_notified";--> statement-breakpoint
ALTER TABLE "incidents" DROP COLUMN "first_aid_received";--> statement-breakpoint
ALTER TABLE "incidents" DROP COLUMN "treated_at_hospital";--> statement-breakpoint
ALTER TABLE "integration_export_log" DROP COLUMN "integration_key";--> statement-breakpoint
ALTER TABLE "tenant_integrations" DROP COLUMN "integration_key";

-- Squashed source: packages/db/drizzle/0034_final_production_invariants.sql
-- Inspection records are immutable snapshots. Preserve the type and criterion
-- behavior on any pre-cutover rows before runtime stops consulting live type
-- configuration. The dev cutover currently has no equipment inspection rows,
-- but this backfill keeps the migration correct for every reviewed database.
ALTER TABLE "equipment_inspection_criteria" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_inspection_record_criteria" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_inspection_records" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_inspection_types" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_record_attachments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_records" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "equipment_inspection_record_criteria" ADD COLUMN "is_required" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment_inspection_records" ADD COLUMN "interval_value" integer;--> statement-breakpoint
ALTER TABLE "equipment_inspection_records" ADD COLUMN "interval_unit" "equipment_interval_unit";--> statement-breakpoint
ALTER TABLE "equipment_inspection_records" ADD COLUMN "is_pre_use" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment_inspection_records" ADD COLUMN "allow_pass_all" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment_inspection_records" ADD COLUMN "fails_spawn_work_orders" boolean DEFAULT true NOT NULL;--> statement-breakpoint

UPDATE "equipment_inspection_record_criteria" AS record_criterion
SET "is_required" = criterion."is_required"
FROM "equipment_inspection_criteria" AS criterion
WHERE record_criterion."criterion_id" = criterion."id"
  AND record_criterion."tenant_id" = criterion."tenant_id";--> statement-breakpoint

UPDATE "equipment_inspection_records" AS record
SET "interval_value" = inspection_type."interval_value",
    "interval_unit" = inspection_type."interval_unit",
    "is_pre_use" = inspection_type."is_pre_use",
    "allow_pass_all" = inspection_type."allow_pass_all",
    "fails_spawn_work_orders" = inspection_type."fails_spawn_work_orders"
FROM "equipment_inspection_types" AS inspection_type
WHERE record."inspection_type_id" = inspection_type."id"
  AND record."tenant_id" = inspection_type."tenant_id";--> statement-breakpoint

-- Fail with bounded, actionable messages before installing the final unique
-- and check constraints. This avoids opaque DDL failures and prevents the
-- cutover from silently choosing a winner for conflicting tenant data.
DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*)
  INTO violation_count
  FROM (
    SELECT 1
    FROM "inspection_record_attachments"
    GROUP BY "tenant_id", "record_id", "attachment_id"
    HAVING count(*) > 1
  ) AS duplicate_attachments;
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Inspection attachment cutover blocked: % duplicate tenant/record/attachment group(s)',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "inspection_records"
  WHERE "status" = 'closed' AND NOT "locked";
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Inspection lifecycle cutover blocked: % closed record(s) are not locked',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "custom_field_definitions"
  WHERE "key" !~ '^[a-z][a-z0-9_]{0,62}$';
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Custom-field cutover blocked: % definition key(s) violate the canonical format',
      violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM "custom_field_definitions"
  WHERE "subtype_id" IS NOT NULL
    AND "entity_kind" NOT IN ('equipment', 'ppe');
  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Custom-field cutover blocked: % non-equipment/PPE definition(s) carry a subtype',
      violation_count;
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "equipment_inspection_criteria" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_inspection_record_criteria" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_inspection_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_inspection_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_record_attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DROP INDEX "inspection_record_attachments_record_idx";--> statement-breakpoint
DROP INDEX "inspection_record_attachments_tenant_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_record_attachments_record_attachment_ux" ON "inspection_record_attachments" USING btree ("tenant_id","record_id","attachment_id");--> statement-breakpoint
ALTER TABLE "inspection_records" ADD CONSTRAINT "inspection_records_closed_locked_ck" CHECK ("inspection_records"."status" <> 'closed' OR "inspection_records"."locked") NOT VALID;--> statement-breakpoint
ALTER TABLE "inspection_records" VALIDATE CONSTRAINT "inspection_records_closed_locked_ck";--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_key_format_ck" CHECK ("custom_field_definitions"."key" ~ '^[a-z][a-z0-9_]{0,62}$') NOT VALID;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" VALIDATE CONSTRAINT "custom_field_definitions_key_format_ck";--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_subtype_kind_ck" CHECK ("custom_field_definitions"."subtype_id" IS NULL OR "custom_field_definitions"."entity_kind" IN ('equipment', 'ppe')) NOT VALID;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" VALIDATE CONSTRAINT "custom_field_definitions_subtype_kind_ck";
