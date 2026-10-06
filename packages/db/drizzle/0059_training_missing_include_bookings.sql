-- Broaden the seeded eligibility rule without bypassing tenant-authored
-- department, person, or other filters. Leave customized eligibility alone.
DO $$
DECLARE
  tenant uuid;
  definition record;
  required_rule jsonb := '{"field":"is_required","op":"is_true"}'::jsonb;
  coverage_rule jsonb := '{"field":"coverage_status","op":"in","value":["missing","expired","expiring"]}'::jsonb;
  rules jsonb;
  next_query jsonb;
  previous_tenant text := current_setting('app.tenant_id', true);
BEGIN
  FOR tenant IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant::text, true);
    FOR definition IN SELECT id, "query" FROM report_definitions
      WHERE tenant_id = tenant AND seed_key = 'training_missing'
        AND "query"->>'entity' = 'training_matrix'
        AND "query"->'filters'->>'combinator' = 'and'
        AND "query"->'filters'->'rules' @> jsonb_build_array(required_rule, coverage_rule)
    LOOP
      SELECT coalesce(jsonb_agg(value ORDER BY ordinal), '[]'::jsonb)
        INTO rules FROM jsonb_array_elements(definition."query"->'filters'->'rules')
          WITH ORDINALITY AS r(value, ordinal)
        WHERE value <> required_rule AND value <> coverage_rule;
      rules := rules || jsonb_build_array(jsonb_build_object('combinator', 'or', 'rules',
        jsonb_build_array('{"field":"booked","op":"is_true"}'::jsonb,
          jsonb_build_object('combinator', 'and', 'rules', jsonb_build_array(required_rule, coverage_rule)))));
      IF NOT jsonb_path_exists(rules, '$.** ? (@.field == "person_status")') THEN
        rules := rules || '[{"field":"person_status","op":"eq","value":"active"}]'::jsonb;
      END IF;
      next_query := jsonb_set(definition."query", '{filters,rules}', rules);
      UPDATE report_definitions SET "query" = next_query, updated_at = now()
        WHERE id = definition.id AND tenant_id = tenant;
      INSERT INTO audit_log (tenant_id, entity_type, entity_id, action, summary, before, after, metadata)
        VALUES (tenant, 'report_definition', definition.id, 'update',
          'Include upcoming bookings in the missing-training report',
          jsonb_build_object('query', definition."query"), jsonb_build_object('query', next_query),
          '{"migration":"0059_training_missing_include_bookings"}'::jsonb);
    END LOOP;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
END $$;
