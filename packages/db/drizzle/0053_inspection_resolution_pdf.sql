-- Extend the recognizable built-in inspection narrative without replacing
-- tenant customization. Existing custom layouts can use the new merge fields.
DO $$
DECLARE
  tenant uuid;
  previous_tenant text := current_setting('app.tenant_id', true);
  previous_fragment text := $old${{#if action_taken}}<div style="white-space:pre-wrap;overflow-wrap:anywhere;margin-top:5px;"><strong>Action taken:</strong> {{action_taken}}</div>{{/if}}$old$;
  resolution_fragment text := $new$
      {{#if resolution}}<div style="margin-top:5px;"><strong>Resolution:</strong> {{resolution}}{{#if corrected_on}} — {{corrected_on}}{{/if}}</div>{{/if}}$new$;
BEGIN
  FOR tenant IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant::text, true);
    WITH updated AS (
      UPDATE pdf_templates
      SET source_html = replace(source_html, previous_fragment, previous_fragment || resolution_fragment),
          compiled_html = replace(compiled_html, previous_fragment, previous_fragment || resolution_fragment),
          updated_at = now()
      WHERE tenant_id = tenant
        AND record_subject_type = 'module' AND record_subject_key = 'inspections'
        AND deleted_at IS NULL
        AND source_html LIKE '%' || previous_fragment || '%'
        AND compiled_html LIKE '%' || previous_fragment || '%'
        AND source_html NOT LIKE '%{{#if resolution}}%'
        AND compiled_html NOT LIKE '%{{#if resolution}}%'
      RETURNING id, key
    )
    INSERT INTO audit_log (tenant_id, entity_type, entity_id, action, summary, after, metadata)
    SELECT tenant, 'pdf_template', id, 'update', 'Added inspection finding resolution and correction date to PDF',
           jsonb_build_object('key', key, 'fields', jsonb_build_array('criteria.resolution', 'criteria.corrected_on')),
           jsonb_build_object('migration', '0053_inspection_resolution_pdf')
    FROM updated;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
END $$;
