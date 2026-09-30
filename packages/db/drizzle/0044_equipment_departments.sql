ALTER TABLE "equipment_items" ADD COLUMN IF NOT EXISTS "department_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_items_department_idx" ON "equipment_items" ("tenant_id", "department_id");
--> statement-breakpoint
DO $$
DECLARE
  tenant uuid;
  previous_tenant text := current_setting('app.tenant_id', true);
  holder_row text := $html$<tr style="page-break-inside:avoid;"><td style="width:18%;border:1px solid #e2e8f0;background:#f1f5f9;padding:5px 8px;font-size:10.5px;font-weight:600;color:#475569;vertical-align:top;">Current holder</td><td colspan="3" style="width:32%;border:1px solid #e2e8f0;padding:5px 8px;font-size:11.5px;color:#0f172a;vertical-align:top;">{{holder_name}}</td></tr>$html$;
  department_row text := $html$<tr style="page-break-inside:avoid;"><td style="width:18%;border:1px solid #e2e8f0;background:#f1f5f9;padding:5px 8px;font-size:10.5px;font-weight:600;color:#475569;vertical-align:top;">Current holder</td><td style="width:32%;border:1px solid #e2e8f0;padding:5px 8px;font-size:11.5px;color:#0f172a;vertical-align:top;">{{holder_name}}</td><td style="width:18%;border:1px solid #e2e8f0;background:#f1f5f9;padding:5px 8px;font-size:10.5px;font-weight:600;color:#475569;vertical-align:top;">Department</td><td style="width:32%;border:1px solid #e2e8f0;padding:5px 8px;font-size:11.5px;color:#0f172a;vertical-align:top;">{{department_name}}</td></tr>$html$;
BEGIN
  -- Establish each tenant's RLS context, including on the migration owner.
  FOR tenant IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant::text, true);
    IF EXISTS (
      SELECT 1 FROM equipment_items
      WHERE tenant_id = tenant AND metadata ? 'division'
        AND jsonb_typeof(metadata->'division') NOT IN ('string', 'null')
    ) THEN
      RAISE EXCEPTION 'Equipment division must be text or null (tenant %)', tenant;
    END IF;

    INSERT INTO departments (tenant_id, name)
    SELECT DISTINCT ON (lower(name)) tenant, name FROM (
      SELECT btrim(regexp_replace(normalize(metadata->>'division', NFKC), '[[:space:]]+', ' ', 'g')) AS name
      FROM equipment_items WHERE tenant_id = tenant
    ) source
    WHERE name <> ''
    ORDER BY lower(name), name
    ON CONFLICT DO NOTHING;

    UPDATE equipment_items item
    SET department_id = department.id
    FROM departments department
    WHERE item.tenant_id = tenant AND department.tenant_id = item.tenant_id
      AND item.department_id IS NULL
      AND lower(btrim(regexp_replace(normalize(department.name, NFKC), '[[:space:]]+', ' ', 'g')))
        = lower(btrim(regexp_replace(normalize(item.metadata->>'division', NFKC), '[[:space:]]+', ' ', 'g')));

    IF EXISTS (
      SELECT 1 FROM equipment_items WHERE tenant_id = tenant
        AND btrim(regexp_replace(normalize(metadata->>'division', NFKC), '[[:space:]]+', ' ', 'g')) <> ''
        AND department_id IS NULL
    ) THEN
      RAISE EXCEPTION 'Equipment department backfill incomplete (tenant %)', tenant;
    END IF;
    UPDATE equipment_items SET metadata = metadata - 'division'
    WHERE tenant_id = tenant AND metadata ? 'division';

    -- Update only the seeded asset sheet's unchanged holder row.
    UPDATE pdf_templates SET
      source_html = replace(source_html, holder_row, department_row),
      compiled_html = replace(compiled_html, holder_row, department_row),
      updated_at = now()
    WHERE tenant_id = tenant AND key = 'equipment-asset-pdf'
      AND record_subject_key = 'equipment-assets' AND deleted_at IS NULL
      AND source_html NOT LIKE '%{{department_name}}%'
      AND strpos(source_html, holder_row) > 0;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_items_tenant_department_fk' AND conrelid = 'equipment_items'::regclass) THEN
    ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_tenant_department_fk"
      FOREIGN KEY ("tenant_id", "department_id") REFERENCES "departments" ("tenant_id", "id");
  END IF;
END $$;
