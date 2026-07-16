DO $$ BEGIN
  CREATE TYPE "public"."hazid_review_status" AS ENUM('pending', 'approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

ALTER TABLE "hazid_assessments"
  ADD COLUMN IF NOT EXISTS "review_status" "hazid_review_status" DEFAULT 'pending' NOT NULL,
  ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "reviewed_by_tenant_user_id" uuid,
  ADD COLUMN IF NOT EXISTS "review_note" text;--> statement-breakpoint

ALTER TABLE "hazid_assessment_questions"
  ADD COLUMN IF NOT EXISTS "source_type_question_id" uuid;--> statement-breakpoint

UPDATE "hazid_assessment_questions" AS question
SET "source_type_question_id" = type_question."id"
FROM "hazid_assessments" AS assessment
INNER JOIN "hazid_assessment_type_questions" AS type_question
  ON type_question."tenant_id" = assessment."tenant_id"
  AND type_question."type_id" = assessment."assessment_type_id"
WHERE question."tenant_id" = assessment."tenant_id"
  AND question."assessment_id" = assessment."id"
  AND type_question."entity_order" = question."entity_order"
  AND type_question."question" = question."question"
  AND question."source_type_question_id" IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "hazid_assessments_review_idx"
  ON "hazid_assessments" USING btree ("tenant_id", "review_status", "reviewed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hazid_assessment_questions_source_question_idx"
  ON "hazid_assessment_questions" USING btree ("tenant_id", "source_type_question_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hazid_assessment_type_questions_tenant_id_id_ux"
  ON "hazid_assessment_type_questions" USING btree ("tenant_id", "id");--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "hazid_assessments"
    ADD CONSTRAINT "hazid_assessments_tenant_reviewed_by_user_fk"
    FOREIGN KEY ("tenant_id", "reviewed_by_tenant_user_id")
    REFERENCES "public"."tenant_users"("tenant_id", "id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "hazid_assessment_questions"
    ADD CONSTRAINT "hazid_assessment_questions_tenant_source_type_question_fk"
    FOREIGN KEY ("tenant_id", "source_type_question_id")
    REFERENCES "public"."hazid_assessment_type_questions"("tenant_id", "id")
    ON DELETE SET NULL ("source_type_question_id") NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "hazid_assessment_questions"
  VALIDATE CONSTRAINT "hazid_assessment_questions_tenant_source_type_question_fk";--> statement-breakpoint

-- Clear every existing hazard-assessment signature when the attested content
-- changes. Keeping this at the database boundary covers native actions,
-- imports, and embedded Builder autosaves without relying on every caller to
-- remember the invariant. Attachment deletion is durable: the existing
-- attachment trigger queues object removal after commit.
CREATE OR REPLACE FUNCTION "invalidate_hazid_assessment_signatures"(
  p_tenant_id uuid,
  p_assessment_id uuid
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_tenant_id IS NULL OR p_assessment_id IS NULL THEN
    RETURN;
  END IF;

  WITH targets AS MATERIALIZED (
    SELECT "id", "signature_attachment_id"
    FROM "hazid_assessment_signatures"
    WHERE "tenant_id" = p_tenant_id
      AND "assessment_id" = p_assessment_id
      AND ("signature_attachment_id" IS NOT NULL OR "signed_at" IS NOT NULL)
    FOR UPDATE
  ), invalidated AS (
    UPDATE "hazid_assessment_signatures" AS signature
    SET
      "signature_attachment_id" = NULL,
      "signed_at" = NULL,
      "updated_at" = now()
    FROM targets
    WHERE signature."id" = targets."id"
    RETURNING targets."signature_attachment_id"
  )
  DELETE FROM "attachments" AS attachment
  USING invalidated
  WHERE invalidated."signature_attachment_id" IS NOT NULL
    AND attachment."tenant_id" = p_tenant_id
    AND attachment."id" = invalidated."signature_attachment_id"
    AND attachment."kind" = 'signature';
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "invalidate_hazid_on_content_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  tenant_id_value uuid;
  assessment_id_value uuid;
  old_content jsonb;
  new_content jsonb;
BEGIN
  IF TG_TABLE_NAME = 'form_responses' THEN
    IF TG_OP = 'DELETE' THEN
      tenant_id_value := OLD.tenant_id;
      assessment_id_value := OLD.source_entity_id;
    ELSE
      tenant_id_value := NEW.tenant_id;
      assessment_id_value := NEW.source_entity_id;
    END IF;

    IF (TG_OP = 'DELETE' AND OLD.source_entity_type IS DISTINCT FROM 'hazid_assessment')
      OR (TG_OP <> 'DELETE' AND NEW.source_entity_type IS DISTINCT FROM 'hazid_assessment') THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    IF TG_OP = 'UPDATE' THEN
      old_content := to_jsonb(OLD) - ARRAY[
        'created_at', 'updated_at', 'pdf_attachment_id', 'locked', 'locked_at',
        'locked_by_tenant_user_id', 'workflow_state', 'current_step',
        'draft_updated_at', 'draft_step_index'
      ];
      new_content := to_jsonb(NEW) - ARRAY[
        'created_at', 'updated_at', 'pdf_attachment_id', 'locked', 'locked_at',
        'locked_by_tenant_user_id', 'workflow_state', 'current_step',
        'draft_updated_at', 'draft_step_index'
      ];
      IF old_content IS NOT DISTINCT FROM new_content THEN
        RETURN NEW;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'hazid_assessments' THEN
    tenant_id_value := NEW.tenant_id;
    assessment_id_value := NEW.id;
    IF TG_OP = 'UPDATE' THEN
      old_content := to_jsonb(OLD) - ARRAY[
        'created_at', 'updated_at', 'in_progress', 'locked', 'locked_at',
        'locked_by_tenant_user_id', 'review_status', 'reviewed_at',
        'reviewed_by_tenant_user_id', 'review_note'
      ];
      new_content := to_jsonb(NEW) - ARRAY[
        'created_at', 'updated_at', 'in_progress', 'locked', 'locked_at',
        'locked_by_tenant_user_id', 'review_status', 'reviewed_at',
        'reviewed_by_tenant_user_id', 'review_note'
      ];
      IF old_content IS NOT DISTINCT FROM new_content THEN
        RETURN NEW;
      END IF;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      tenant_id_value := OLD.tenant_id;
      assessment_id_value := OLD.assessment_id;
    ELSE
      tenant_id_value := NEW.tenant_id;
      assessment_id_value := NEW.assessment_id;
    END IF;
    IF TG_OP = 'UPDATE' THEN
      old_content := to_jsonb(OLD) - ARRAY['created_at', 'updated_at'];
      new_content := to_jsonb(NEW) - ARRAY['created_at', 'updated_at'];
      IF old_content IS NOT DISTINCT FROM new_content THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  PERFORM "invalidate_hazid_assessment_signatures"(tenant_id_value, assessment_id_value);
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "hazid_assessments_invalidate_signatures" ON "hazid_assessments";--> statement-breakpoint
CREATE TRIGGER "hazid_assessments_invalidate_signatures"
AFTER UPDATE ON "hazid_assessments"
FOR EACH ROW EXECUTE FUNCTION "invalidate_hazid_on_content_change"();--> statement-breakpoint

DROP TRIGGER IF EXISTS "hazid_assessment_tasks_invalidate_signatures" ON "hazid_assessment_tasks";--> statement-breakpoint
CREATE TRIGGER "hazid_assessment_tasks_invalidate_signatures"
AFTER INSERT OR UPDATE OR DELETE ON "hazid_assessment_tasks"
FOR EACH ROW EXECUTE FUNCTION "invalidate_hazid_on_content_change"();--> statement-breakpoint

DROP TRIGGER IF EXISTS "hazid_assessment_hazards_invalidate_signatures" ON "hazid_assessment_hazards";--> statement-breakpoint
CREATE TRIGGER "hazid_assessment_hazards_invalidate_signatures"
AFTER INSERT OR UPDATE OR DELETE ON "hazid_assessment_hazards"
FOR EACH ROW EXECUTE FUNCTION "invalidate_hazid_on_content_change"();--> statement-breakpoint

DROP TRIGGER IF EXISTS "hazid_assessment_ppe_invalidate_signatures" ON "hazid_assessment_ppe";--> statement-breakpoint
CREATE TRIGGER "hazid_assessment_ppe_invalidate_signatures"
AFTER INSERT OR UPDATE OR DELETE ON "hazid_assessment_ppe"
FOR EACH ROW EXECUTE FUNCTION "invalidate_hazid_on_content_change"();--> statement-breakpoint

DROP TRIGGER IF EXISTS "hazid_assessment_questions_invalidate_signatures" ON "hazid_assessment_questions";--> statement-breakpoint
CREATE TRIGGER "hazid_assessment_questions_invalidate_signatures"
AFTER INSERT OR UPDATE OR DELETE ON "hazid_assessment_questions"
FOR EACH ROW EXECUTE FUNCTION "invalidate_hazid_on_content_change"();--> statement-breakpoint

DROP TRIGGER IF EXISTS "hazid_assessment_photos_invalidate_signatures" ON "hazid_assessment_photos";--> statement-breakpoint
CREATE TRIGGER "hazid_assessment_photos_invalidate_signatures"
AFTER INSERT OR UPDATE OR DELETE ON "hazid_assessment_photos"
FOR EACH ROW EXECUTE FUNCTION "invalidate_hazid_on_content_change"();--> statement-breakpoint

DROP TRIGGER IF EXISTS "hazid_assessment_apps_invalidate_signatures" ON "hazid_assessment_app_responses";--> statement-breakpoint
CREATE TRIGGER "hazid_assessment_apps_invalidate_signatures"
AFTER INSERT OR UPDATE OR DELETE ON "hazid_assessment_app_responses"
FOR EACH ROW EXECUTE FUNCTION "invalidate_hazid_on_content_change"();--> statement-breakpoint

DROP TRIGGER IF EXISTS "hazid_form_response_invalidate_signatures" ON "form_responses";--> statement-breakpoint
CREATE TRIGGER "hazid_form_response_invalidate_signatures"
AFTER UPDATE OR DELETE ON "form_responses"
FOR EACH ROW EXECUTE FUNCTION "invalidate_hazid_on_content_change"();
