DO $$ BEGIN
  CREATE TYPE form_response_capture_mode AS ENUM ('digital', 'external');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE form_responses
  ADD COLUMN IF NOT EXISTS capture_mode form_response_capture_mode NOT NULL DEFAULT 'digital',
  ADD COLUMN IF NOT EXISTS external_reference text,
  ADD COLUMN IF NOT EXISTS external_issuer text,
  ADD COLUMN IF NOT EXISTS external_notes text;
--> statement-breakpoint
-- Enable the external-paper capture choice only on the two seeded JSA plans.
-- Keep other record_config settings intact and preserve tenant RLS.
DO $migration$
DECLARE tenant_row record;
BEGIN
  FOR tenant_row IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant_row.id::text, true);
    UPDATE form_templates
       SET record_config = jsonb_set(
         COALESCE(record_config, '{}'::jsonb),
         '{externalCapture}',
         '{"enabled":true,"referenceLabel":"Assessment number","requirePhoto":false}'::jsonb,
         true
       ), updated_at = now()
     WHERE tenant_id = tenant_row.id AND deleted_at IS NULL
       AND key IN ('hazid-confined-space-entry-plan', 'hazid-fall-protection-plan');
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END;
$migration$;
--> statement-breakpoint
-- Move only the generated, built-in Fall Protection PDF rows. A tenant's
-- edited template is left alone unless every identifying field and heading is
-- still present. The Rescue equipment value is re-rendered in its section
-- because it shares a generated two-column row with anchor_rated.
DO $migration$
DECLARE
  tenant_row record;
  access_heading constant text := '<table style="width:100%;border-collapse:collapse;"><tr><td colspan="1" style="border:none;padding:14px 0 6px;"><div style="font-size:13px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.6px;margin:0;border-bottom:2px solid #0f172a;padding-bottom:3px;">Access &amp; communication</div></td></tr></table>';
  rescue_heading constant text := '<table style="width:100%;border-collapse:collapse;"><tr><td colspan="1" style="border:none;padding:14px 0 6px;"><div style="font-size:13px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.6px;margin:0;border-bottom:2px solid #0f172a;padding-bottom:3px;">Rescue</div></td></tr></table>';
  moved_source constant text := '<table style="width:100%;border-collapse:collapse;table-layout:fixed;margin:0 0 10px;"><tr data-if="anchor_rated_text" style="page-break-inside:avoid"><td style="width:18%;border:1px solid #e2e8f0;background:#f1f5f9;padding:5px 8px;font-size:10.5px;font-weight:600;color:#475569;vertical-align:top;">Anchor points rated and adequate for the load?</td><td colspan="3" style="width:32%;border:1px solid #e2e8f0;padding:5px 8px;font-size:11.5px;color:#0f172a;vertical-align:top;">{{anchor_rated_text}}</td></tr><tr data-if="equipment_inspected_text" style="page-break-inside:avoid"><td style="width:18%;border:1px solid #e2e8f0;background:#f1f5f9;padding:5px 8px;font-size:10.5px;font-weight:600;color:#475569;vertical-align:top;">Harnesses, lanyards, and SRLs inspected before use?</td><td colspan="3" style="width:32%;border:1px solid #e2e8f0;padding:5px 8px;font-size:11.5px;color:#0f172a;vertical-align:top;">{{equipment_inspected_text}}</td></tr><tr data-if="hierarchy_applied_text" style="page-break-inside:avoid"><td style="width:18%;border:1px solid #e2e8f0;background:#f1f5f9;padding:5px 8px;font-size:10.5px;font-weight:600;color:#475569;vertical-align:top;">Guardrails / travel restraint used before fall arrest where practical?</td><td colspan="3" style="width:32%;border:1px solid #e2e8f0;padding:5px 8px;font-size:11.5px;color:#0f172a;vertical-align:top;">{{hierarchy_applied_text}}</td></tr></table>';
  moved_compiled constant text := '<table style="width:100%;border-collapse:collapse;table-layout:fixed;margin:0 0 10px;">{{#if anchor_rated_text}}<tr style="page-break-inside:avoid"><td style="width:18%;border:1px solid #e2e8f0;background:#f1f5f9;padding:5px 8px;font-size:10.5px;font-weight:600;color:#475569;vertical-align:top;">Anchor points rated and adequate for the load?</td><td colspan="3" style="width:32%;border:1px solid #e2e8f0;padding:5px 8px;font-size:11.5px;color:#0f172a;vertical-align:top;">{{anchor_rated_text}}</td></tr>{{/if}}{{#if equipment_inspected_text}}<tr style="page-break-inside:avoid"><td style="width:18%;border:1px solid #e2e8f0;background:#f1f5f9;padding:5px 8px;font-size:10.5px;font-weight:600;color:#475569;vertical-align:top;">Harnesses, lanyards, and SRLs inspected before use?</td><td colspan="3" style="width:32%;border:1px solid #e2e8f0;padding:5px 8px;font-size:11.5px;color:#0f172a;vertical-align:top;">{{equipment_inspected_text}}</td></tr>{{/if}}{{#if hierarchy_applied_text}}<tr style="page-break-inside:avoid"><td style="width:18%;border:1px solid #e2e8f0;background:#f1f5f9;padding:5px 8px;font-size:10.5px;font-weight:600;color:#475569;vertical-align:top;">Guardrails / travel restraint used before fall arrest where practical?</td><td colspan="3" style="width:32%;border:1px solid #e2e8f0;padding:5px 8px;font-size:11.5px;color:#0f172a;vertical-align:top;">{{hierarchy_applied_text}}</td></tr>{{/if}}</table>';
  rescue_equipment_source constant text := '<table style="width:100%;border-collapse:collapse;table-layout:fixed;margin:0 0 10px;"><tr data-if="equipment_text" style="page-break-inside:avoid"><td style="width:18%;border:1px solid #e2e8f0;background:#f1f5f9;padding:5px 8px;font-size:10.5px;font-weight:600;color:#475569;vertical-align:top;">Rescue equipment</td><td colspan="3" style="width:32%;border:1px solid #e2e8f0;padding:5px 8px;font-size:11.5px;color:#0f172a;vertical-align:top;">{{equipment_text}}</td></tr></table>';
  rescue_equipment_compiled constant text := '<table style="width:100%;border-collapse:collapse;table-layout:fixed;margin:0 0 10px;">{{#if equipment_text}}<tr style="page-break-inside:avoid"><td style="width:18%;border:1px solid #e2e8f0;background:#f1f5f9;padding:5px 8px;font-size:10.5px;font-weight:600;color:#475569;vertical-align:top;">Rescue equipment</td><td colspan="3" style="width:32%;border:1px solid #e2e8f0;padding:5px 8px;font-size:11.5px;color:#0f172a;vertical-align:top;">{{equipment_text}}</td></tr>{{/if}}</table>';
BEGIN
  FOR tenant_row IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant_row.id::text, true);
    UPDATE pdf_templates
       SET source_html = replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(source_html,
                   '<tr[^>]*>.*?{{anchor_rated_text}}.*?</tr>', '', 'g'),
                 '<tr[^>]*>.*?{{equipment_inspected_text}}.*?</tr>', '', 'g'),
               '<tr[^>]*>.*?{{hierarchy_applied_text}}.*?</tr>', '', 'g'),
             rescue_heading, moved_source || rescue_heading || rescue_equipment_source),
           compiled_html = replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(compiled_html,
                   '<tr[^>]*>.*?{{anchor_rated_text}}.*?</tr>', '', 'g'),
                 '<tr[^>]*>.*?{{equipment_inspected_text}}.*?</tr>', '', 'g'),
               '<tr[^>]*>.*?{{hierarchy_applied_text}}.*?</tr>', '', 'g'),
             rescue_heading, moved_compiled || rescue_heading || rescue_equipment_compiled),
           updated_at = now()
     WHERE tenant_id = tenant_row.id
       AND key = 'form-hazid-fall-protection-plan-pdf'
       AND record_subject_type = 'form_template'
       AND position(access_heading in source_html) > 0
       AND position(rescue_heading in source_html) > 0
       AND position('{{anchor_rated_text}}' in source_html) > 0
       AND position('{{equipment_inspected_text}}' in source_html) > 0
       AND position('{{hierarchy_applied_text}}' in source_html) > 0
       AND position('{{anchor_rated_text}}' in compiled_html) > 0
       AND position('{{equipment_inspected_text}}' in compiled_html) > 0
       AND position('{{hierarchy_applied_text}}' in compiled_html) > 0
       AND position(moved_source in source_html) = 0
       AND position(moved_compiled in compiled_html) = 0;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END;
$migration$;
