ALTER TABLE training_extra_fields ADD COLUMN IF NOT EXISTS value_mode text NOT NULL DEFAULT 'record';
ALTER TABLE training_skill_types ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE training_skill_types ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE training_skill_types ADD COLUMN IF NOT EXISTS credential_output_ids jsonb NOT NULL DEFAULT '[]';
ALTER TABLE training_skill_types ADD COLUMN IF NOT EXISTS view_source text NOT NULL DEFAULT 'evidence';
ALTER TABLE training_skill_assignments ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';
--> statement-breakpoint
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = t.id AND slug = 'rassaun') THEN
      UPDATE training_skill_types SET credential_output_ids = coalesce((
        SELECT jsonb_agg(o->>'id') FROM tenants tenant,
          jsonb_array_elements(coalesce(tenant.settings->'trainingCredentialOutputs', '[{"id":"certificate","enabled":true},{"id":"wallet-card","enabled":true}]'::jsonb)) o
        WHERE tenant.id = t.id AND coalesce((o->>'enabled')::boolean, false)), '[]'::jsonb)
      WHERE tenant_id = t.id;
    END IF;
    UPDATE training_extra_fields SET value_mode = 'type' WHERE tenant_id = t.id AND skill_type_id IS NOT NULL AND nullif(trim(field_value), '') IS NOT NULL;
    UPDATE training_skill_assignments SET status = CASE
      WHEN lower(split_part(coalesce(notes, ''), ' · ', 1)) IN ('complete','expired','tested','recommended','failed')
        THEN lower(split_part(notes, ' · ', 1))
      WHEN lower(split_part(coalesce(notes, ''), ' · ', 1)) = 'inprogress' THEN 'draft'
      WHEN person_id IS NOT NULL AND skill_type_id IS NOT NULL THEN 'complete'
      ELSE 'draft' END
    WHERE tenant_id = t.id;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE training_skill_assignments ADD CONSTRAINT training_skill_assignments_status_ck
  CHECK (status IN ('draft','expired','complete','tested','recommended','failed'));
ALTER TABLE training_skill_types ADD CONSTRAINT training_skill_types_view_source_ck CHECK (view_source IN ('evidence','generated'));
ALTER TABLE training_skill_types ADD CONSTRAINT training_skill_types_outputs_ck CHECK (jsonb_typeof(credential_output_ids) = 'array');

ALTER TABLE training_extra_fields ADD CONSTRAINT training_extra_fields_value_mode_ck CHECK (value_mode IN ('record','type'));
