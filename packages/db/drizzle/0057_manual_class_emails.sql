ALTER TABLE training_classes ADD COLUMN IF NOT EXISTS email_queued_at timestamptz;
ALTER TABLE training_classes ADD COLUMN IF NOT EXISTS email_actor jsonb;
ALTER TABLE training_classes ADD COLUMN IF NOT EXISTS reminder_hours integer;
ALTER TABLE training_classes ADD COLUMN IF NOT EXISTS reminder_queued_for timestamptz;
--> statement-breakpoint
DO $$
DECLARE
  tenant uuid;
  flow record;
  nodes jsonb;
  emails jsonb;
  reminder_nodes jsonb;
  reminder_edges jsonb;
  reminder_trigger text;
  previous_tenant text := current_setting('app.tenant_id', true);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_classes_reminder_hours_check' AND conrelid = 'training_classes'::regclass) THEN
    ALTER TABLE training_classes ADD CONSTRAINT training_classes_reminder_hours_check CHECK (reminder_hours IS NULL OR reminder_hours IN (24,48,168));
  END IF;
  FOR tenant IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant::text, true);
    FOR flow IN SELECT * FROM form_automations WHERE tenant_id = tenant AND subject_type = 'module' AND subject_key = 'training-classes' LOOP
      SELECT jsonb_agg(
        CASE
          WHEN node #>> '{data,trigger,trigger}' = 'on_create' THEN jsonb_set(node, '{data,trigger}', '{"trigger":"class_confirmed"}'::jsonb)
          WHEN node #>> '{data,action,action}' = 'send_email' AND node #>> '{data,action,mode}' = 'inline' THEN
            jsonb_set(node, '{data,action,bodyTemplate}', to_jsonb(replace(replace(coalesce(node #>> '{data,action,bodyTemplate}', ''), '{{course_description}}', ''), 'Location:', 'Class location:')))
          ELSE node END ORDER BY ordinal)
      INTO nodes FROM jsonb_array_elements(flow.graph->'nodes') WITH ORDINALITY AS n(node, ordinal);
      IF nodes IS DISTINCT FROM flow.graph->'nodes' THEN
        UPDATE form_automations SET graph = jsonb_set(flow.graph, '{nodes}', nodes),
          name = CASE WHEN name = 'Training class scheduled — email' THEN 'Training class email' ELSE name END, updated_at = now()
          WHERE id = flow.id AND tenant_id = tenant;
        INSERT INTO audit_log (tenant_id, entity_type, entity_id, action, summary, metadata)
          VALUES (tenant, 'form_automation', flow.id, 'update', 'Made initial class email manual and removed course-description text', '{"migration":"0057_manual_class_emails"}'::jsonb);
      END IF;
      -- Offer a separate reminder email using the existing delivery audience.
      -- It cannot run until a manager opts in on a manually announced class.
      IF flow.name = 'Training class scheduled — email' AND NOT EXISTS (
        SELECT 1 FROM form_automations WHERE tenant_id = tenant AND subject_key = 'training-classes' AND name = 'Training class reminder email'
      ) THEN
        SELECT jsonb_agg(node ORDER BY ordinal) INTO emails FROM jsonb_array_elements(nodes) WITH ORDINALITY AS n(node, ordinal)
          WHERE node #>> '{data,action,action}' = 'send_email';
        IF jsonb_array_length(coalesce(emails, '[]'::jsonb)) > 0 THEN
          SELECT jsonb_agg(jsonb_set(node, '{data,action,subject}', to_jsonb('Reminder: ' || coalesce(node #>> '{data,action,subject}', 'Training class'))) ORDER BY ordinal)
            INTO emails FROM jsonb_array_elements(emails) WITH ORDINALITY AS n(node, ordinal);
          reminder_trigger := gen_random_uuid()::text;
          reminder_nodes := jsonb_build_array(jsonb_build_object('id',reminder_trigger, 'position',jsonb_build_object('x',0,'y',0), 'data',jsonb_build_object('kind','trigger','trigger',jsonb_build_object('trigger','class_reminder')))) || emails;
          SELECT jsonb_agg(jsonb_build_object('id','reminder-edge-' || ordinal, 'source',reminder_trigger,'target',node->>'id','sourceHandle','next')) INTO reminder_edges
            FROM jsonb_array_elements(emails) WITH ORDINALITY AS n(node, ordinal);
          WITH created AS (INSERT INTO form_automations (tenant_id, subject_type, subject_key, name, enabled, graph)
            VALUES (tenant, 'module', 'training-classes', 'Training class reminder email', flow.enabled,
              jsonb_build_object('schemaVersion',1,'nodes',reminder_nodes,'edges',reminder_edges)) RETURNING id)
          INSERT INTO audit_log (tenant_id, entity_type, entity_id, action, summary, metadata)
            SELECT tenant, 'form_automation', id, 'create', 'Created optional class reminder email flow', '{"migration":"0057_manual_class_emails"}'::jsonb FROM created;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
END $$;
