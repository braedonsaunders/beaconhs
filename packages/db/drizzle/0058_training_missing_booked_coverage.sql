-- Replace only the displayed coverage column in the seeded missing-training
-- report. Eligibility filters still use the underlying certificate status.
-- Preserve tenant-authored filters, grouping, layouts and column labels.
DO $$
DECLARE
  tenant uuid;
  definition record;
  columns jsonb;
  labels jsonb;
  next_query jsonb;
  previous_tenant text := current_setting('app.tenant_id', true);
BEGIN
  FOR tenant IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant::text, true);
    FOR definition IN SELECT id, "query" FROM report_definitions
      WHERE tenant_id = tenant AND seed_key = 'training_missing'
        AND "query"->>'entity' = 'training_matrix'
        AND "query"->'columns' ? 'coverage_status'
    LOOP
      SELECT jsonb_agg(CASE WHEN value = '"coverage_status"'::jsonb
        THEN '"booking_coverage_status"'::jsonb ELSE value END ORDER BY ordinal)
        INTO columns FROM jsonb_array_elements(definition."query"->'columns')
          WITH ORDINALITY AS c(value, ordinal);
      labels := coalesce(nullif(definition."query"->'columnLabels', 'null'::jsonb), '{}'::jsonb);
      labels := jsonb_set(labels, '{booking_coverage_status}',
        coalesce(labels->'booking_coverage_status', labels->'coverage_status', '"Coverage"'::jsonb));
      next_query := jsonb_set(jsonb_set(definition."query", '{columns}', columns), '{columnLabels}', labels);
      UPDATE report_definitions SET "query" = next_query, updated_at = now()
        WHERE id = definition.id AND tenant_id = tenant;
      INSERT INTO audit_log (tenant_id, entity_type, entity_id, action, summary, before, after, metadata)
        VALUES (tenant, 'report_definition', definition.id, 'update',
          'Show upcoming bookings in missing-training coverage',
          jsonb_build_object('query', definition."query"), jsonb_build_object('query', next_query),
          '{"migration":"0058_training_missing_booked_coverage"}'::jsonb);
    END LOOP;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
END $$;
