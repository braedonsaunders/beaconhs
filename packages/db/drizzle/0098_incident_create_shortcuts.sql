-- Retire saved links to the removed quick-report page without dropping layouts.
-- Establish tenant context because both layout tables use FORCE RLS.
DO $$
DECLARE
  tenant uuid;
  previous_tenant text := current_setting('app.tenant_id', true);
BEGIN
  FOR tenant IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant::text, true);
    UPDATE user_dashboard_layouts SET layout = jsonb_set(layout, '{quickActions}', (
      SELECT jsonb_agg(CASE WHEN item->>'href' = '/incidents/new'
        THEN jsonb_set(item, '{href}', '"/incidents"'::jsonb) ELSE item END ORDER BY position)
      FROM jsonb_array_elements(layout->'quickActions') WITH ORDINALITY AS action(item, position)
    )) WHERE tenant_id = tenant AND layout->'quickActions' @> '[{"href":"/incidents/new"}]'::jsonb;
    UPDATE role_dashboard_layouts SET layout = jsonb_set(layout, '{quickActions}', (
      SELECT jsonb_agg(CASE WHEN item->>'href' = '/incidents/new'
        THEN jsonb_set(item, '{href}', '"/incidents"'::jsonb) ELSE item END ORDER BY position)
      FROM jsonb_array_elements(layout->'quickActions') WITH ORDINALITY AS action(item, position)
    )) WHERE tenant_id = tenant AND layout->'quickActions' @> '[{"href":"/incidents/new"}]'::jsonb;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
END $$;
