-- Preserve existing manager access at cutover. New grants are explicit role
-- permissions; read-only and worker roles do not gain custody access.
DO $$
DECLARE
  tenant uuid;
  previous_tenant text := current_setting('app.tenant_id', true);
BEGIN
  FOR tenant IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant::text, true);
    UPDATE roles
       SET permissions = permissions || '["equipment.custody"]'::jsonb,
           updated_at = now()
     WHERE tenant_id = tenant
       AND permissions ? 'equipment.manage'
       AND NOT (permissions ? 'equipment.custody');
    -- Preserve explicit grants and denials too: a management denial must not
    -- acquire custody through the role backfill above.
    INSERT INTO user_permission_overrides (tenant_id, tenant_user_id, permission, effect)
      SELECT tenant_id, tenant_user_id, 'equipment.custody', effect
        FROM user_permission_overrides
       WHERE tenant_id = tenant AND permission = 'equipment.manage'
    ON CONFLICT (tenant_user_id, permission) DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
END $$;
