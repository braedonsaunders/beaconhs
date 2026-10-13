-- Other PPE inspections: a pre-use check of gear that is not in the register
-- (rental, client-supplied, a subcontractor's or a worker's own). The
-- inspection carries its own PPE type, serial, and supplier instead of an item.
ALTER TABLE "ppe_inspections" ALTER COLUMN "item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ppe_inspections" ADD COLUMN IF NOT EXISTS "type_id" uuid;--> statement-breakpoint
ALTER TABLE "ppe_inspections" ADD COLUMN IF NOT EXISTS "is_other" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ppe_inspections" ADD COLUMN IF NOT EXISTS "serial_number" text;--> statement-breakpoint
ALTER TABLE "ppe_inspections" ADD COLUMN IF NOT EXISTS "supplied_by" text;--> statement-breakpoint
ALTER TABLE "ppe_issue_reports" ALTER COLUMN "item_id" DROP NOT NULL;--> statement-breakpoint

-- The legacy cutover could not represent an inspection without an item, so it
-- invented one "recovered historical PPE inspection subject" per orphaned
-- legacy "Other PPE" inspection (or per type + serial). Those items are not
-- inventory: convert their inspections back to other-PPE inspections, move
-- their defect reports onto the inspection, and delete the invented items.
--
-- Every inspection also gets its PPE type snapshot, and the ETL's raw
-- "Legacy PPE evidence: {json}" note suffix becomes one readable line.
-- FORCE RLS applies to the migration owner, so each tenant is scoped in turn.
DO $$
DECLARE
  tenant uuid;
  previous_tenant text := current_setting('app.tenant_id', true);
  inspection record;
  evidence jsonb;
  snapshot jsonb;
  source_notes text;
  details text[];
BEGIN
  FOR tenant IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant::text, true);

    UPDATE ppe_inspections i
    SET type_id = it.type_id
    FROM ppe_items it
    WHERE i.tenant_id = tenant
      AND it.tenant_id = tenant
      AND it.id = i.item_id
      AND i.type_id IS NULL;

    IF EXISTS (
      SELECT 1
      FROM ppe_items it
      WHERE it.tenant_id = tenant
        AND it.metadata ->> 'legacy' = 'PPEINSPECTIONS_SYNTHETIC_ITEM'
        AND (
          EXISTS (SELECT 1 FROM ppe_issues l WHERE l.tenant_id = tenant AND l.item_id = it.id)
          OR EXISTS (
            SELECT 1 FROM ppe_annual_records a WHERE a.tenant_id = tenant AND a.item_id = it.id
          )
          OR EXISTS (
            SELECT 1
            FROM ppe_issue_reports r
            WHERE r.tenant_id = tenant AND r.item_id = it.id AND r.inspection_id IS NULL
          )
        )
    ) THEN
      RAISE EXCEPTION 'Recovered legacy PPE items carry issuance, certificate, or unlinked defect history (tenant %)', tenant;
    END IF;

    UPDATE ppe_issue_reports r
    SET item_id = NULL
    FROM ppe_items it
    WHERE r.tenant_id = tenant
      AND it.tenant_id = tenant
      AND it.id = r.item_id
      AND it.metadata ->> 'legacy' = 'PPEINSPECTIONS_SYNTHETIC_ITEM';

    FOR inspection IN
      SELECT i.id, i.notes, it.metadata ->> 'sourceSerialSnapshot' AS item_serial
      FROM ppe_inspections i
      JOIN ppe_items it ON it.tenant_id = i.tenant_id AND it.id = i.item_id
      WHERE i.tenant_id = tenant
        AND it.metadata ->> 'legacy' = 'PPEINSPECTIONS_SYNTHETIC_ITEM'
    LOOP
      evidence := NULL;
      BEGIN
        evidence := substring(inspection.notes from 'Legacy PPE evidence: (\{.*\})\s*$')::jsonb;
      EXCEPTION WHEN others THEN
        evidence := NULL;
      END;
      UPDATE ppe_inspections
      SET item_id = NULL,
          is_other = true,
          serial_number = nullif(
            btrim(coalesce(
              evidence #>> '{legacyEquipmentSnapshot,main,serialNumber}',
              inspection.item_serial
            )),
            ''
          )
      WHERE tenant_id = tenant AND id = inspection.id;
    END LOOP;

    DELETE FROM ppe_items
    WHERE tenant_id = tenant
      AND metadata ->> 'legacy' = 'PPEINSPECTIONS_SYNTHETIC_ITEM';

    FOR inspection IN
      SELECT id, notes, is_other
      FROM ppe_inspections
      WHERE tenant_id = tenant AND notes LIKE '%Legacy PPE evidence: {%'
    LOOP
      evidence := NULL;
      BEGIN
        evidence := substring(inspection.notes from 'Legacy PPE evidence: (\{.*\})\s*$')::jsonb;
      EXCEPTION WHEN others THEN
        evidence := NULL;
      END;
      CONTINUE WHEN evidence IS NULL;
      snapshot := evidence -> 'legacyEquipmentSnapshot';
      source_notes := nullif(
        btrim(regexp_replace(inspection.notes, '\s*Legacy PPE evidence: \{.*\}\s*$', '')),
        ''
      );
      details := array_remove(ARRAY[
        nullif(btrim(snapshot ->> 'legacyType'), ''),
        'Model ' || nullif(btrim(snapshot #>> '{main,name}'), ''),
        CASE WHEN NOT inspection.is_other
          THEN 'Serial ' || nullif(btrim(snapshot #>> '{main,serialNumber}'), '')
        END,
        'Paired with ' || nullif(concat_ws(
          ' ',
          nullif(btrim(snapshot #>> '{secondary,name}'), ''),
          '(serial ' || nullif(btrim(snapshot #>> '{secondary,serialNumber}'), '') || ')'
        ), ''),
        'Belongs to ' || nullif(btrim(snapshot ->> 'belongsTo'), '')
      ], NULL);
      UPDATE ppe_inspections
      SET notes = nullif(concat_ws(
        E'\n\n',
        source_notes,
        CASE WHEN cardinality(details) > 0
          THEN 'Legacy record: ' || array_to_string(details, ' · ')
        END
      ), '')
      WHERE tenant_id = tenant AND id = inspection.id;
    END LOOP;

    IF EXISTS (SELECT 1 FROM ppe_inspections WHERE tenant_id = tenant AND type_id IS NULL) THEN
      RAISE EXCEPTION 'PPE inspection type backfill incomplete (tenant %)', tenant;
    END IF;
    IF EXISTS (
      SELECT 1 FROM ppe_items
      WHERE tenant_id = tenant AND metadata ->> 'legacy' = 'PPEINSPECTIONS_SYNTHETIC_ITEM'
    ) THEN
      RAISE EXCEPTION 'Recovered legacy PPE items remain after conversion (tenant %)', tenant;
    END IF;

    -- The system PPE inspection PDF names the supplier of other PPE. Only the
    -- untouched seeded row shape is rewritten; tenant-edited HTML is left alone.
    UPDATE pdf_templates
    SET source_html = replace(source_html, '">{{holder_name}}</td></tr></table>', '">{{holder_name}}</td></tr><tr data-if="supplied_by" style="page-break-inside:avoid;"><td style="width:18%;border:1px solid #e2e8f0;background:#f1f5f9;padding:5px 8px;font-size:10.5px;font-weight:600;color:#475569;vertical-align:top;">Supplied by</td><td colspan="3" style="width:32%;border:1px solid #e2e8f0;padding:5px 8px;font-size:11.5px;color:#0f172a;vertical-align:top;">{{supplied_by}}</td></tr></table>'),
        compiled_html = replace(compiled_html, '">{{holder_name}}</td></tr></table>', '">{{holder_name}}</td></tr><tr data-if="supplied_by" style="page-break-inside:avoid;"><td style="width:18%;border:1px solid #e2e8f0;background:#f1f5f9;padding:5px 8px;font-size:10.5px;font-weight:600;color:#475569;vertical-align:top;">Supplied by</td><td colspan="3" style="width:32%;border:1px solid #e2e8f0;padding:5px 8px;font-size:11.5px;color:#0f172a;vertical-align:top;">{{supplied_by}}</td></tr></table>'),
        updated_at = now()
    WHERE tenant_id = tenant
      AND key = 'ppe-inspection-pdf'
      AND record_subject_type = 'module'
      AND record_subject_key = 'ppe'
      AND deleted_at IS NULL
      AND position('{{supplied_by}}' IN source_html) = 0
      AND position('">{{holder_name}}</td></tr></table>' IN source_html) > 0;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
END $$;--> statement-breakpoint

ALTER TABLE "ppe_inspections" ALTER COLUMN "type_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ppe_inspections_type_idx" ON "ppe_inspections" ("tenant_id", "type_id");--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ppe_inspections_tenant_type_fk'
      AND conrelid = 'public.ppe_inspections'::regclass
  ) THEN
    ALTER TABLE "ppe_inspections"
      ADD CONSTRAINT "ppe_inspections_tenant_type_fk"
      FOREIGN KEY ("tenant_id", "type_id") REFERENCES "ppe_types" ("tenant_id", "id");
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ppe_inspections_target_ck'
      AND conrelid = 'public.ppe_inspections'::regclass
  ) THEN
    ALTER TABLE "ppe_inspections" ADD CONSTRAINT "ppe_inspections_target_ck" CHECK ((
      ("is_other" = false AND "item_id" IS NOT NULL AND "serial_number" IS NULL AND "supplied_by" IS NULL)
      OR ("is_other" = true AND "item_id" IS NULL)
    ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ppe_issue_reports_subject_ck'
      AND conrelid = 'public.ppe_issue_reports'::regclass
  ) THEN
    ALTER TABLE "ppe_issue_reports" ADD CONSTRAINT "ppe_issue_reports_subject_ck"
      CHECK ("item_id" IS NOT NULL OR "inspection_id" IS NOT NULL);
  END IF;
END $$;
