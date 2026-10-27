-- Link email_log rows to the record they are about, and make every existing
-- training-class flow email each recipient individually so class attendees
-- never see each other's addresses on a shared To line.
ALTER TABLE "email_log" ADD COLUMN IF NOT EXISTS "subject_type" text;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN IF NOT EXISTS "subject_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_log_subject_idx" ON "email_log" USING btree ("tenant_id","subject_type","subject_id","created_at");--> statement-breakpoint
DO $$
DECLARE
  tenant uuid;
  flow record;
  nodes jsonb;
  previous_tenant text := current_setting('app.tenant_id', true);
BEGIN
  FOR tenant IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant::text, true);
    FOR flow IN
      SELECT * FROM form_automations
      WHERE tenant_id = tenant
        AND subject_type = 'module'
        AND subject_key = 'training-classes'
        AND graph::text LIKE '%send_email%'
      FOR UPDATE
    LOOP
      SELECT jsonb_agg(
        CASE
          WHEN node #>> '{data,action,action}' = 'send_email'
            AND coalesce(node #>> '{data,action,channel}', 'email') = 'email'
          THEN jsonb_set(node, '{data,action,individualCopies}', 'true'::jsonb)
          ELSE node
        END ORDER BY ordinal)
      INTO nodes
      FROM jsonb_array_elements(flow.graph->'nodes') WITH ORDINALITY AS n(node, ordinal);
      IF nodes IS DISTINCT FROM flow.graph->'nodes' THEN
        UPDATE form_automations
        SET graph = jsonb_set(flow.graph, '{nodes}', nodes), updated_at = now()
        WHERE id = flow.id AND tenant_id = tenant;
        INSERT INTO audit_log (tenant_id, entity_type, entity_id, action, summary, before, after, metadata)
        VALUES (
          tenant,
          'form_automation',
          flow.id,
          'update',
          'Class emails now go to each recipient individually',
          jsonb_build_object('graph', flow.graph),
          jsonb_build_object('graph', jsonb_set(flow.graph, '{nodes}', nodes)),
          '{"migration":"0100_email_subject_linkage_and_individual_class_emails"}'::jsonb
        );
      END IF;
    END LOOP;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
END $$;
