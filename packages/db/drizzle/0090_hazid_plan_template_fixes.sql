-- This migration publishes the corrected Fall Protection template and repairs
-- the known confined-space app key. Tenant data changes run under tenant RLS.
DO $migration$
DECLARE tenant_row record; published_count integer;
BEGIN
  FOR tenant_row IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant_row.id::text, true);
    -- Publish the corrected Fall Protection schema as a new immutable version.
    WITH latest AS (
      SELECT DISTINCT ON (v.template_id) v.*
        FROM form_template_versions v
        JOIN form_templates t ON t.id = v.template_id AND t.tenant_id = v.tenant_id
       WHERE v.tenant_id = tenant_row.id AND t.key = 'hazid-fall-protection-plan'
         AND t.deleted_at IS NULL AND v.published_at IS NOT NULL
       ORDER BY v.template_id, v.version DESC
    ), moved AS (
      SELECT l.*, jsonb_set(l.schema, '{sections}', (
        SELECT jsonb_agg(
          CASE WHEN section->>'id' = 'wah_access' THEN
            jsonb_set(section, '{fields}',
              COALESCE(section->'fields', '[]'::jsonb) ||
              COALESCE((SELECT jsonb_agg(field ORDER BY ord)
                  FROM jsonb_array_elements(l.schema->'sections') sec2
                  CROSS JOIN LATERAL jsonb_array_elements(sec2->'fields') WITH ORDINALITY f(field, ord)
                 WHERE sec2->>'id' = 'wah_protection'
                   AND field->>'id' IN ('anchor_rated','equipment_inspected','hierarchy_applied')),
                '[]'::jsonb), true)
          WHEN section->>'id' = 'wah_protection' THEN
            jsonb_set(jsonb_set(section, '{title,en}', '"Rescue"'::jsonb, true), '{fields}',
              COALESCE((SELECT jsonb_agg(field ORDER BY ord)
                  FROM jsonb_array_elements(section->'fields') WITH ORDINALITY f(field, ord)
                 WHERE field->>'id' NOT IN ('anchor_rated','equipment_inspected','hierarchy_applied')),
                '[]'::jsonb), true)
          ELSE section END ORDER BY ord)
          FROM jsonb_array_elements(l.schema->'sections') WITH ORDINALITY s(section, ord)
      ), false) AS new_schema
      FROM latest l
    ), inserted AS (
      INSERT INTO form_template_versions (tenant_id, template_id, version, schema, changelog, published_at, created_at, updated_at)
      SELECT tenant_id, template_id, version + 1,
             CASE WHEN jsonb_typeof(new_schema->'workflow'->'steps') = 'array'
               THEN jsonb_set(new_schema, '{workflow,steps}',
                 (SELECT jsonb_agg(CASE WHEN step->>'key' = 'protection'
                   THEN jsonb_set(step, '{title}', '{"en":"Rescue"}'::jsonb, true) ELSE step END ORDER BY ord)
                    FROM jsonb_array_elements(new_schema->'workflow'->'steps') WITH ORDINALITY x(step, ord)), true)
               ELSE new_schema END,
             'Move anchorage checks into Access & communication; clarify Rescue section', now(), now(), now()
        FROM moved
       WHERE new_schema IS NOT NULL
         -- Idempotent: only templates whose Rescue section still holds the
         -- anchorage checks get a new version.
         AND EXISTS (
           SELECT 1
             FROM jsonb_array_elements(schema->'sections') sec
             CROSS JOIN LATERAL jsonb_array_elements(sec->'fields') f(field)
            WHERE sec->>'id' = 'wah_protection' AND field->>'id' = 'anchor_rated'
         )
       RETURNING template_id
    ) SELECT count(*) INTO published_count FROM inserted;

    -- The erroneous key is only a type-app lookup key. Do not touch responses or
    -- conditions; their references are checked by the app's stable type-app id.
    UPDATE hazid_assessment_type_apps
       SET key = 'confined_space_entry_plan', updated_at = now()
     WHERE tenant_id = tenant_row.id AND key = 'embed_verify'
       AND template_id IN (SELECT id FROM form_templates WHERE tenant_id = tenant_row.id
                            AND key = 'hazid-confined-space-entry-plan');
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END;
$migration$;
