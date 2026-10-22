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
-- Tenant-specific configuration corrections. Existing signed response versions stay immutable.
DO $$
DECLARE tenant_key uuid := '362623eb-f615-4610-b2f9-3422dde18cf4';
        previous_tenant text := current_setting('app.tenant_id',true);
        welding_id uuid; changed_set record; new_version_id uuid; template_key uuid; latest_record record; corrected jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM tenants WHERE id=tenant_key AND slug='rassaun') THEN RETURN; END IF;
 PERFORM set_config('app.tenant_id',tenant_key::text,true);
 SELECT id INTO welding_id FROM hazid_hazards WHERE tenant_id=tenant_key AND name='Welding' AND deleted_at IS NULL ORDER BY id LIMIT 1;
 IF welding_id IS NOT NULL THEN
  FOR changed_set IN UPDATE hazid_hazard_sets SET hazard_ids=hazard_ids || jsonb_build_array(welding_id::text),updated_at=now()
   WHERE tenant_id=tenant_key AND name IN ('Standard Mechanical Hazards','Standard Electrical Hazards','Fabrication Shop') AND NOT hazard_ids ? welding_id::text RETURNING id LOOP
    INSERT INTO audit_log(tenant_id,entity_type,entity_id,action,summary,metadata) VALUES(tenant_key,'hazid_hazard_set',changed_set.id,'update','Add existing Welding hazard to default set','{"migration":"0084"}'::jsonb);
  END LOOP;
 END IF;
 FOR template_key IN SELECT id FROM form_templates WHERE tenant_id=tenant_key AND key='hazid-fall-protection-plan' AND deleted_at IS NULL LOOP
  SELECT * INTO latest_record FROM form_template_versions WHERE tenant_id=tenant_key AND template_id=template_key AND published_at IS NOT NULL ORDER BY version DESC LIMIT 1;
  IF latest_record.id IS NULL THEN CONTINUE; END IF;
  SELECT jsonb_set(latest_record.schema,'{sections}',jsonb_agg(
   jsonb_set(section,'{fields}',COALESCE((SELECT jsonb_agg(
     CASE WHEN field->>'id'='equipment' AND field->'label'->>'en'='Fall-protection equipment'
     THEN jsonb_set(field,'{label}',COALESCE(field->'label','{}'::jsonb) || '{"en":"Rescue equipment","fr":"Équipement de sauvetage","es":"Equipo de rescate"}'::jsonb)
     ELSE field END ORDER BY field_number)
     FROM jsonb_array_elements(section->'fields') WITH ORDINALITY f(field,field_number)),'[]'::jsonb)) ORDER BY section_number))
   INTO corrected FROM jsonb_array_elements(latest_record.schema->'sections') WITH ORDINALITY s(section,section_number);
  IF corrected IS DISTINCT FROM latest_record.schema THEN
   INSERT INTO form_template_versions(tenant_id,template_id,version,schema,changelog,published_at)
    VALUES(tenant_key,template_key,(SELECT max(version)+1 FROM form_template_versions WHERE tenant_id=tenant_key AND template_id=template_key),corrected,'Correct rescue equipment label without changing existing responses',now()) RETURNING id INTO new_version_id;
   INSERT INTO audit_log(tenant_id,entity_type,entity_id,action,summary,metadata) VALUES(tenant_key,'form_template',template_key,'update','Publish corrected rescue equipment label',jsonb_build_object('migration','0084','versionId',new_version_id));
  END IF;
 END LOOP;
 PERFORM set_config('app.tenant_id',coalesce(previous_tenant,''),true);
END;
$$;
