ALTER TABLE training_classes ADD COLUMN IF NOT EXISTS location text;
--> statement-breakpoint
-- Repair the built-in attendance sheet fragments while preserving all other
-- tenant-authored layout changes. Each tenant context is required by FORCE RLS.
DO $$
DECLARE
  tenant uuid;
  previous_tenant text := current_setting('app.tenant_id', true);
  course_source text := $fragment$<table style="width:100%;border-collapse:collapse;margin:0 0 10px;"><tr data-if="course_description" style="page-break-inside:avoid;"><td style="border:none;padding:12px 0 0;"><div style="font-size:13px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.6px;margin:0;border-bottom:2px solid #0f172a;padding-bottom:3px;">About this course</div><div style="border:1px solid #e2e8f0;border-left:3px solid #0f172a;background:#f8fafc;padding:8px 10px;font-size:11.5px;color:#0f172a;line-height:1.55;white-space:pre-wrap;margin-top:6px;">{{course_description}}</div></td></tr></table>$fragment$;
  course_compiled text;
  old_cell text := $fragment$padding:5px 8px;font-size:11.5px;color:#0f172a;vertical-align:top;width:27%;$fragment$;
BEGIN
  course_compiled := replace(replace(course_source,
    '<tr data-if="course_description" style="page-break-inside:avoid;">',
    '{{#if course_description}}<tr style="page-break-inside:avoid;">'),
    '</tr></table>', '</tr>{{/if}}</table>');
  FOR tenant IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant::text, true);
    WITH updated AS (
      UPDATE pdf_templates
      SET source_html = replace(replace(source_html, course_source, ''), old_cell, old_cell || 'overflow-wrap:anywhere;'),
          compiled_html = replace(replace(compiled_html, course_compiled, ''), old_cell, old_cell || 'overflow-wrap:anywhere;'),
          updated_at = now()
      WHERE tenant_id = tenant AND key = 'training-class-pdf'
        AND record_subject_type = 'module' AND record_subject_key = 'training-classes'
        AND deleted_at IS NULL
        AND (position(course_source in source_html) > 0 OR
             (position(old_cell in source_html) > 0 AND position(old_cell || 'overflow-wrap:anywhere;' in source_html) = 0))
      RETURNING id
    )
    INSERT INTO audit_log (tenant_id, entity_type, entity_id, action, summary, metadata)
    SELECT tenant, 'pdf_template', id, 'update', 'Corrected class attendance sheet layout',
           jsonb_build_object('migration', '0054_training_class_location_print') FROM updated;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
END $$;
