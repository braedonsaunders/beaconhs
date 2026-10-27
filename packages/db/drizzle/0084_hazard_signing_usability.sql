-- Signed evidence is retained even when no content snapshot was recorded.
CREATE OR REPLACE FUNCTION invalidate_hazid_assessment_signatures(p_tenant_id uuid, p_assessment_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE parent_revision integer; parent_locked boolean; frozen_at timestamptz;
BEGIN
  IF p_tenant_id IS NULL OR p_assessment_id IS NULL THEN RETURN; END IF;
  SELECT signing_revision, locked, signing_frozen_at INTO parent_revision, parent_locked, frozen_at
    FROM hazid_assessments WHERE tenant_id = p_tenant_id AND id = p_assessment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF parent_locked THEN RAISE EXCEPTION 'This assessment is locked. Unlock it to make changes.'; END IF;
  IF frozen_at IS NOT NULL OR EXISTS (
    SELECT 1 FROM hazid_assessment_signatures WHERE tenant_id = p_tenant_id
      AND assessment_id = p_assessment_id AND revision = parent_revision
      AND (signature_attachment_id IS NOT NULL OR signed_at IS NOT NULL)
  ) THEN
    PERFORM advance_hazid_signing_revision(p_tenant_id, p_assessment_id, parent_revision);
  END IF;
END;
$$;
--> statement-breakpoint
-- Presentation-only reorder operations preserve signatures and signing requests.
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
      old_content := to_jsonb(OLD) - ARRAY['created_at', 'updated_at', 'entity_order', 'sort_order'];
      new_content := to_jsonb(NEW) - ARRAY['created_at', 'updated_at', 'entity_order', 'sort_order'];
      IF old_content IS NOT DISTINCT FROM new_content THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  PERFORM "invalidate_hazid_assessment_signatures"(tenant_id_value, assessment_id_value);
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
--> statement-breakpoint
-- Tenant-specific configuration corrections were applied as a one-off data
-- change for the affected workspace; they are intentionally not part of the
-- platform migration history.
SELECT 1;
