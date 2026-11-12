-- incidents.update.own / hazid.update.own are new rights that wildcard roles
-- (incidents.*, hazid.*) grant automatically. A user explicitly denied the full
-- edit right must not regain editing of their own records through them, so
-- carry each existing edit denial over to the matching edit-own right.
DO $$
DECLARE
  tenant uuid;
  previous_tenant text := current_setting('app.tenant_id', true);
BEGIN
  FOR tenant IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant::text, true);
    INSERT INTO user_permission_overrides (tenant_id, tenant_user_id, permission, effect)
      SELECT tenant_id, tenant_user_id, permission || '.own', effect
        FROM user_permission_overrides
       WHERE tenant_id = tenant
         AND permission IN ('incidents.update', 'hazid.update')
         AND effect = 'deny'
    ON CONFLICT (tenant_user_id, permission) DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
END $$;
