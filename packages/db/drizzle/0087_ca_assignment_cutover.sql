-- Corrective-action assignment cutover:
-- 1. Drop the dead `is_draft` column — nothing ever set it, no sweep exists,
--    and the schema comment described behaviour that was never built.
-- 2. Teach the tenant flow named "Corrective action assigned — email" to
--    also fire on reassignment: append an `on_owner_change` trigger node
--    wired to the same first step as its `on_create` trigger. Flows that
--    already carry the trigger (or were renamed/customized away from that
--    shape) are left untouched.
ALTER TABLE "corrective_actions" DROP COLUMN IF EXISTS "is_draft";
--> statement-breakpoint
DO $migration$
DECLARE
  tenant_row record;
  flow_row record;
  create_trigger_id text;
  first_target text;
  new_graph jsonb;
BEGIN
  FOR tenant_row IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant_row.id::text, true);
    FOR flow_row IN
      SELECT id, graph
      FROM form_automations
      WHERE tenant_id = tenant_row.id
        AND subject_type = 'module'
        AND subject_key = 'corrective-actions'
        AND name = 'Corrective action assigned — email'
        AND position('on_owner_change' in graph::text) = 0
    LOOP
      SELECT node->>'id'
      INTO create_trigger_id
      FROM jsonb_array_elements(flow_row.graph->'nodes') AS node
      WHERE node->'data'->>'kind' = 'trigger'
        AND node->'data'->'trigger'->>'trigger' = 'on_create'
      LIMIT 1;
      IF create_trigger_id IS NULL THEN
        CONTINUE;
      END IF;
      SELECT edge->>'target'
      INTO first_target
      FROM jsonb_array_elements(flow_row.graph->'edges') AS edge
      WHERE edge->>'source' = create_trigger_id
      LIMIT 1;
      IF first_target IS NULL THEN
        CONTINUE;
      END IF;
      new_graph := jsonb_set(
        jsonb_set(
          flow_row.graph,
          '{nodes}',
          (flow_row.graph->'nodes') || jsonb_build_object(
            'id', 'trigger-owner-change',
            'data', jsonb_build_object(
              'kind', 'trigger',
              'trigger', jsonb_build_object('trigger', 'on_owner_change')
            ),
            'position', jsonb_build_object('x', 0, 'y', 140)
          )
        ),
        '{edges}',
        (flow_row.graph->'edges') || jsonb_build_object(
          'id', 'e-owner-change',
          'source', 'trigger-owner-change',
          'target', first_target,
          'sourceHandle', 'next'
        )
      );
      UPDATE form_automations
      SET graph = new_graph,
          updated_at = now()
      WHERE tenant_id = tenant_row.id
        AND id = flow_row.id;
    END LOOP;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END;
$migration$;
