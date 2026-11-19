-- Incidents now start as drafts that the reporter submits, and have no manual
-- lock (closing locks; any other status reopens). Cut existing incident flow
-- graphs over: "on create" and "on lock" both meant "the report is in", which
-- is now the submit event; "on unlock" meant reopening, now a status change to
-- reopened. Flow rows carry tenant RLS, so each tenant is updated in its own
-- context.
DO $$
DECLARE
  tenant uuid;
  previous_tenant text := current_setting('app.tenant_id', true);
BEGIN
  FOR tenant IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant::text, true);
    WITH migrated AS (
      SELECT
        "id",
        jsonb_set(
          "graph",
          '{nodes}',
          COALESCE(
            (
              SELECT jsonb_agg(
                CASE
                  WHEN node #>> '{data,kind}' = 'trigger'
                    AND node #>> '{data,trigger,trigger}' IN ('on_create', 'on_lock')
                  THEN jsonb_set(node, '{data,trigger}', '{"trigger":"on_submit"}'::jsonb)
                  WHEN node #>> '{data,kind}' = 'trigger'
                    AND node #>> '{data,trigger,trigger}' = 'on_unlock'
                  THEN jsonb_set(
                    node,
                    '{data,trigger}',
                    '{"trigger":"status_change","to":"reopened"}'::jsonb
                  )
                  ELSE node
                END
                ORDER BY ordinal
              )
              FROM jsonb_array_elements(COALESCE("graph" -> 'nodes', '[]'::jsonb))
                WITH ORDINALITY AS nodes(node, ordinal)
            ),
            '[]'::jsonb
          ),
          false
        ) AS next_graph
      FROM "form_automations"
      WHERE "tenant_id" = tenant
        AND "subject_type" = 'module'
        AND "subject_key" = 'incidents'
    )
    UPDATE "form_automations" AS flow
    SET "graph" = migrated.next_graph,
        "updated_at" = now()
    FROM migrated
    WHERE flow."id" = migrated."id"
      AND flow."graph" IS DISTINCT FROM migrated.next_graph;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
END $$;
