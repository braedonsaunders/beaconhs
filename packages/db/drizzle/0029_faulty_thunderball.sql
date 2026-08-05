ALTER TABLE "equipment_inspection_records" ALTER COLUMN "equipment_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment_inspection_records" ADD COLUMN "equipment_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "equipment_inspection_records" ADD COLUMN "rental_provider" text;--> statement-breakpoint
UPDATE "equipment_inspection_records" AS r
SET "equipment_name_snapshot" = COALESCE(r."equipment_name_snapshot", i."name"),
    "rental_provider" = COALESCE(r."rental_provider", i."rental_provider")
FROM "equipment_items" AS i
WHERE i."tenant_id" = r."tenant_id"
  AND i."id" = r."equipment_item_id";--> statement-breakpoint
UPDATE "equipment_inspection_records"
SET "equipment_item_id" = NULL
WHERE "is_rental" = true;--> statement-breakpoint
ALTER TABLE "equipment_inspection_records" ADD CONSTRAINT "equipment_inspection_records_target_mode_ck" CHECK ((
        ("equipment_inspection_records"."is_rental" = false and "equipment_inspection_records"."equipment_item_id" is not null)
        or ("equipment_inspection_records"."is_rental" = true and "equipment_inspection_records"."equipment_item_id" is null and nullif(trim("equipment_inspection_records"."equipment_name_snapshot"), '') is not null)
      ));--> statement-breakpoint

-- Hazard assessments use the shared Locations catalogue (customers, projects,
-- sites, and areas). Keep the canonical system PDF terminology aligned with
-- the app without rewriting tenant-authored templates.
ALTER TABLE "pdf_templates" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "pdf_templates"
SET "source_html" = regexp_replace(
      regexp_replace("source_html", '>Site</td>', '>Location</td>'),
      '>Location on site</td>',
      '>Specific location</td>'
    ),
    "compiled_html" = regexp_replace(
      regexp_replace("compiled_html", '>Site</td>', '>Location</td>'),
      '>Location on site</td>',
      '>Specific location</td>'
    ),
    "updated_at" = now()
WHERE "key" = 'hazid-assessment-pdf'
  AND "record_subject_type" = 'module'
  AND "record_subject_key" = 'hazid'
  AND "deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "pdf_templates" FORCE ROW LEVEL SECURITY;
