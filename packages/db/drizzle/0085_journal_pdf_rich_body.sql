-- Print the formatted journal body (paragraphs, lists, emphasis) instead of the
-- flattened plain text, and label the site field "Location" as the app does.
-- Only built-in fragments are rewritten; tenant-customized layouts that no
-- longer contain them are deliberately preserved.
DO $migration$
DECLARE
  tenant_row record;
  site_cell constant text := '<td style="width:32%;border:1px solid #e2e8f0;padding:5px 8px;font-size:11.5px;color:#0f172a;vertical-align:top;">{{site_name}}</td>';
  old_body constant text := 'border:1px solid #e2e8f0;border-left:3px solid #0f172a;background:#f8fafc;padding:8px 10px;font-size:11.5px;color:#0f172a;line-height:1.55;white-space:pre-wrap;margin-top:6px;">{{body_text}}</div>';
  new_body constant text := 'border:1px solid #e2e8f0;border-left:3px solid #0f172a;background:#f8fafc;padding:2px 10px;font-size:11.5px;color:#0f172a;line-height:1.55;overflow-wrap:anywhere;margin-top:6px;">{{{body_html}}}</div>';
BEGIN
  FOR tenant_row IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant_row.id::text, true);
    UPDATE pdf_templates
    SET source_html = replace(replace(replace(source_html,
          '>Site</td>' || site_cell, '>Location</td>' || site_cell),
          old_body, new_body),
          'data-if="body_text"', 'data-if="body_html"'),
        compiled_html = replace(replace(replace(compiled_html,
          '>Site</td>' || site_cell, '>Location</td>' || site_cell),
          old_body, new_body),
          '{{#if body_text}}', '{{#if body_html}}'),
        updated_at = now()
    WHERE tenant_id = tenant_row.id
      AND key = 'journal-entry-pdf'
      AND record_subject_type = 'module'
      AND record_subject_key = 'journals'
      AND position(old_body in source_html) > 0
      AND position(old_body in compiled_html) > 0
      AND position('data-if="body_text"' in source_html) > 0
      AND position('{{#if body_text}}' in compiled_html) > 0;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END;
$migration$;
