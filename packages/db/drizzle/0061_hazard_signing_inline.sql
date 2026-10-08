-- Signing snapshots remain immutable; ordinary edits automatically retire the old
-- signature set instead of requiring a separate user-facing revision workflow.
CREATE OR REPLACE FUNCTION advance_hazid_signing_revision(p_tenant_id uuid, p_assessment_id uuid, p_revision integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE current_revision integer;
BEGIN
  SELECT signing_revision INTO current_revision FROM hazid_assessments
    WHERE tenant_id = p_tenant_id AND id = p_assessment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assessment not found'; END IF;
  IF current_revision <> p_revision THEN RAISE EXCEPTION 'Assessment changed; retry the operation'; END IF;
  UPDATE hazid_signing_rounds SET ended_at = now(), updated_at = now()
    WHERE tenant_id = p_tenant_id AND assessment_id = p_assessment_id AND revision = current_revision;
  INSERT INTO hazid_assessment_signatures
    (tenant_id, assessment_id, revision, signature_type, person_id, external_name, signer_name, cs_entrant, cs_attendant, cs_rescue)
    SELECT s.tenant_id, s.assessment_id, current_revision + 1, s.signature_type, s.person_id,
      s.external_name, s.signer_name, s.cs_entrant, s.cs_attendant, s.cs_rescue
    FROM hazid_assessment_signatures s LEFT JOIN people p ON p.tenant_id = s.tenant_id AND p.id = s.person_id
    WHERE s.tenant_id = p_tenant_id AND s.assessment_id = p_assessment_id AND s.revision = current_revision
      AND (s.person_id IS NULL OR (p.status = 'active' AND p.deleted_at IS NULL));
  UPDATE hazid_assessments SET signing_revision = current_revision + 1, signing_frozen_at = NULL,
    review_status = 'pending', reviewed_at = NULL, reviewed_by_tenant_user_id = NULL, review_note = NULL,
    updated_at = now()
    WHERE tenant_id = p_tenant_id AND id = p_assessment_id;
  RETURN current_revision + 1;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION invalidate_hazid_assessment_signatures(p_tenant_id uuid, p_assessment_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE parent_revision integer; parent_locked boolean; frozen_at timestamptz;
BEGIN
  IF p_tenant_id IS NULL OR p_assessment_id IS NULL THEN RETURN; END IF;
  SELECT signing_revision, locked, signing_frozen_at INTO parent_revision, parent_locked, frozen_at
    FROM hazid_assessments WHERE tenant_id = p_tenant_id AND id = p_assessment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF parent_locked THEN RAISE EXCEPTION 'This assessment is locked. Unlock it to make changes.'; END IF;
  IF frozen_at IS NOT NULL THEN
    PERFORM advance_hazid_signing_revision(p_tenant_id, p_assessment_id, parent_revision);
    RETURN;
  END IF;
  WITH targets AS MATERIALIZED (
    SELECT id, signature_attachment_id FROM hazid_assessment_signatures
    WHERE tenant_id = p_tenant_id AND assessment_id = p_assessment_id AND revision = parent_revision
      AND (signature_attachment_id IS NOT NULL OR signed_at IS NOT NULL) FOR UPDATE
  ), invalidated AS (
    UPDATE hazid_assessment_signatures s SET signature_attachment_id = NULL, signed_at = NULL, updated_at = now()
    FROM targets WHERE s.id = targets.id RETURNING targets.signature_attachment_id
  ) DELETE FROM attachments a USING invalidated
    WHERE invalidated.signature_attachment_id IS NOT NULL AND a.tenant_id = p_tenant_id
      AND a.id = invalidated.signature_attachment_id AND a.kind = 'signature';
END;
$$;--> statement-breakpoint

-- Release unfinished apps frozen by the former shared-phone flow. Submitted
-- apps retain their own lock; submitted assessments retain their parent lock.
DO $$
DECLARE tenant_key uuid; prior_tenant text := current_setting('app.tenant_id', true);
BEGIN
  FOR tenant_key IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant_key::text, true);
    UPDATE audit_log a SET entity_type = 'hazid_assessment', entity_id = s.assessment_id,
      summary = coalesce(s.signer_name, s.external_name, 'Crew member') || ' signed',
      "after" = coalesce(a."after", '{}'::jsonb) || jsonb_build_object('signer', s.signer_name, 'signatureAttachmentId', s.signature_attachment_id)
      FROM hazid_assessment_signatures s
      WHERE a.tenant_id = tenant_key AND s.tenant_id = tenant_key AND a.entity_type = 'hazid_assessment_signature'
        AND a.entity_id = s.id AND a.action = 'sign';
    UPDATE form_responses r SET locked = false, locked_at = NULL, locked_by_tenant_user_id = NULL
      FROM hazid_assessments a
      WHERE r.tenant_id = tenant_key AND r.tenant_id = a.tenant_id AND r.source_entity_id = a.id
        AND r.source_entity_type = 'hazid_assessment' AND a.locked = false AND a.signing_frozen_at IS NOT NULL
        AND r.status IN ('draft', 'in_progress') AND r.locked = true;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(prior_tenant, ''), true);
END;
$$;
