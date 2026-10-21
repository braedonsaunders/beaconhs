-- Delivery scope is owned by the flow, independently of compliance lifecycle.
DO $migration$
DECLARE tenant_row record; flow_row record; node jsonb; target jsonb;
  nodes jsonb; targets jsonb; binding jsonb; next_graph jsonb; missing boolean;
BEGIN
  FOR tenant_row IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant_row.id::text, true);
    FOR flow_row IN SELECT id, graph, enabled FROM form_automations
      WHERE tenant_id = tenant_row.id AND graph::text LIKE '%compliance_recipient%' FOR UPDATE
    LOOP
      nodes := '[]'::jsonb; missing := false;
      FOR node IN SELECT value FROM jsonb_array_elements(flow_row.graph->'nodes') LOOP
        IF node#>>'{data,action,action}' = 'send_email' THEN
          targets := '[]'::jsonb;
          FOR target IN SELECT value FROM jsonb_array_elements(node#>'{data,action,to}') LOOP
            IF target->>'type' = 'compliance_recipient' THEN
              SELECT jsonb_build_object('type','audience_recipient','audienceName',o.title,
                'workerType',o.worker_type,'personField',target->>'personField','recipient',target->'recipient',
                'audience',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',a.kind,'entityKey',a.entity_key,'excluded',a.excluded) ORDER BY a.id)
                  FROM compliance_audience a WHERE a.tenant_id=tenant_row.id AND a.obligation_id=o.id),'[]'::jsonb))
                INTO binding FROM compliance_obligations o
                WHERE o.tenant_id=tenant_row.id AND o.id::text=target->>'obligationId';
              IF binding IS NULL THEN
                missing := true;
                binding := jsonb_build_object('type','audience_recipient','audienceName','Unavailable assignment',
                  'workerType','all','personField',target->>'personField','recipient',target->'recipient','audience','[]'::jsonb);
              END IF;
              target := binding;
            END IF;
            targets := targets || jsonb_build_array(target);
          END LOOP;
          node := jsonb_set(node,'{data,action,to}',targets);
        END IF;
        nodes := nodes || jsonb_build_array(node);
      END LOOP;
      next_graph := jsonb_set(flow_row.graph,'{nodes}',nodes);
      UPDATE form_automations SET graph=next_graph, enabled=flow_row.enabled AND NOT missing, updated_at=now()
        WHERE tenant_id=tenant_row.id AND id=flow_row.id;
      INSERT INTO audit_log (tenant_id,entity_type,entity_id,action,summary,before,after)
        VALUES (tenant_row.id,'form_automation',flow_row.id,'update','Separated email recipient audience from compliance assignment lifecycle',
          jsonb_build_object('graph',flow_row.graph,'enabled',flow_row.enabled),
          jsonb_build_object('graph',next_graph,'enabled',flow_row.enabled AND NOT missing));
    END LOOP;
  END LOOP;
  PERFORM set_config('app.tenant_id','',true);
END;
$migration$;
