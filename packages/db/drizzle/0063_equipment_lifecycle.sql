ALTER TABLE equipment_inspection_types ADD COLUMN IF NOT EXISTS allow_na boolean NOT NULL DEFAULT false;
ALTER TABLE equipment_work_orders ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE training_skill_authorities ADD COLUMN IF NOT EXISTS account_number text;
--> statement-breakpoint
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    UPDATE roles SET permissions = (SELECT coalesce(jsonb_agg(DISTINCT CASE WHEN v = 'hazid.read.others' THEN 'hazid.read.all' ELSE v END), '[]'::jsonb) FROM jsonb_array_elements_text(permissions) v) WHERE tenant_id = t.id AND permissions ? 'hazid.read.others';
    INSERT INTO user_permission_overrides (id, tenant_id, tenant_user_id, permission, effect)
      SELECT gen_random_uuid(), tenant_id, tenant_user_id, 'hazid.read.all', effect FROM user_permission_overrides WHERE tenant_id = t.id AND permission = 'hazid.read.others'
      ON CONFLICT (tenant_user_id, permission) DO UPDATE SET effect = CASE WHEN user_permission_overrides.effect = 'deny' OR excluded.effect = 'deny' THEN 'deny'::permission_override_effect ELSE 'grant'::permission_override_effect END;
    DELETE FROM user_permission_overrides WHERE tenant_id = t.id AND permission = 'hazid.read.others';
    UPDATE equipment_inspection_types it SET allow_na = true
    WHERE it.tenant_id = t.id AND EXISTS (
      SELECT 1 FROM equipment_inspection_criteria c
      WHERE c.tenant_id = t.id AND c.inspection_type_id = it.id AND c.kind = 'pass_fail_na');
  END LOOP;
END $$;
