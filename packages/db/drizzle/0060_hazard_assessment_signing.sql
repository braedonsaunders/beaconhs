ALTER TABLE hazid_assessments ADD COLUMN IF NOT EXISTS signing_revision integer NOT NULL DEFAULT 1;
ALTER TABLE hazid_assessments ADD COLUMN IF NOT EXISTS signing_frozen_at timestamptz;
ALTER TABLE hazid_assessment_signatures ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE hazid_assessment_signatures ADD COLUMN IF NOT EXISTS signer_name text;
ALTER TABLE hazid_assessment_signatures ADD COLUMN IF NOT EXISTS requested_at timestamptz;
ALTER TABLE hazid_assessment_signatures ADD COLUMN IF NOT EXISTS request_id uuid;
ALTER TABLE hazid_assessment_signatures ADD COLUMN IF NOT EXISTS request_expires_at timestamptz;
CREATE TABLE IF NOT EXISTS hazid_signing_rounds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 assessment_id uuid NOT NULL,
 revision integer NOT NULL,
 snapshot jsonb NOT NULL,
 ended_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT hazid_signing_rounds_tenant_assessment_fk FOREIGN KEY (tenant_id, assessment_id) REFERENCES hazid_assessments(tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS hazid_signing_rounds_revision_ux ON hazid_signing_rounds(tenant_id, assessment_id, revision);

CREATE OR REPLACE FUNCTION "invalidate_hazid_assessment_signatures"(
  p_tenant_id uuid,
  p_assessment_id uuid
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  parent_revision integer;
  parent_locked boolean;
  frozen_at timestamptz;
BEGIN
  IF p_tenant_id IS NULL OR p_assessment_id IS NULL THEN
    RETURN;
  END IF;

  SELECT signing_revision, locked, signing_frozen_at INTO parent_revision, parent_locked, frozen_at
    FROM hazid_assessments WHERE tenant_id = p_tenant_id AND id = p_assessment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF parent_locked OR frozen_at IS NOT NULL THEN
    RAISE EXCEPTION 'Signing content is frozen. Start a new assessment revision before making changes.';
  END IF;
  WITH targets AS MATERIALIZED (
    SELECT "id", "signature_attachment_id"
    FROM "hazid_assessment_signatures"
    WHERE "tenant_id" = p_tenant_id
      AND "assessment_id" = p_assessment_id
      AND "revision" = parent_revision
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
        'reviewed_by_tenant_user_id', 'review_note', 'signing_revision', 'signing_frozen_at', 'deleted_at'
      ];
      new_content := to_jsonb(NEW) - ARRAY[
        'created_at', 'updated_at', 'in_progress', 'locked', 'locked_at',
        'locked_by_tenant_user_id', 'review_status', 'reviewed_at',
        'reviewed_by_tenant_user_id', 'review_note', 'signing_revision', 'signing_frozen_at', 'deleted_at'
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
