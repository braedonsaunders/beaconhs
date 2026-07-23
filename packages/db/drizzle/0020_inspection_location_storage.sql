-- Upgraded environments already FORCE RLS on these tenant tables. The
-- migration runner assumes their NOLOGIN owner role, so relax FORCE only for
-- this transaction while promoting the legacy JSON value and reconciling the
-- canonical seeded PDF.
ALTER TABLE "inspection_records" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pdf_templates" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "inspection_records"
  ADD COLUMN IF NOT EXISTS "location_on_site" text;--> statement-breakpoint

UPDATE "inspection_records"
SET "location_on_site" = NULLIF(btrim("metadata"->>'locationOnSite'), '')
WHERE "location_on_site" IS NULL
  AND NULLIF(btrim("metadata"->>'locationOnSite'), '') IS NOT NULL;--> statement-breakpoint

-- Clean cutover: locationOnSite has one canonical home after the backfill.
UPDATE "inspection_records"
SET "metadata" = "metadata" - 'locationOnSite'
WHERE "metadata" ? 'locationOnSite';--> statement-breakpoint

-- Legacy Customer is the linked Location in the new app, not a second
-- customer relationship. The ETL already placed it in site_org_unit_id.
UPDATE "inspection_records"
SET "customer_org_unit_id" = NULL
WHERE "metadata"->>'legacy' = 'JOBSITEINSPECTIONS'
  AND "customer_org_unit_id" IS NOT NULL;--> statement-breakpoint

-- Existing seeded inspection PDFs used the org-unit Site token in the slot
-- intended for the linked Location. Add the specific on-site text alongside
-- it and update only the canonical
-- seeded template key; tenant-created templates are untouched.
UPDATE "pdf_templates"
SET "source_html" = regexp_replace(
      regexp_replace("source_html", '>Site</td>', '>Location</td>'),
      '\{\{site_name\}\}</td></tr>',
      '{{site_name}}</td></tr><tr data-if="location_on_site" style="page-break-inside:avoid;"><td style="width:18%;border:1px solid #e2e8f0;background:#f1f5f9;padding:5px 8px;font-size:10.5px;font-weight:600;color:#475569;vertical-align:top;">Location on site</td><td colspan="3" style="width:32%;border:1px solid #e2e8f0;padding:5px 8px;font-size:11.5px;color:#0f172a;vertical-align:top;">{{location_on_site}}</td></tr>'
    ),
    "compiled_html" = regexp_replace(
      regexp_replace("compiled_html", '>Site</td>', '>Location</td>'),
      '\{\{site_name\}\}</td></tr>',
      '{{site_name}}</td></tr><tr data-if="location_on_site" style="page-break-inside:avoid;"><td style="width:18%;border:1px solid #e2e8f0;background:#f1f5f9;padding:5px 8px;font-size:10.5px;font-weight:600;color:#475569;vertical-align:top;">Location on site</td><td colspan="3" style="width:32%;border:1px solid #e2e8f0;padding:5px 8px;font-size:11.5px;color:#0f172a;vertical-align:top;">{{location_on_site}}</td></tr>'
    ),
    "updated_at" = now()
WHERE "key" = 'inspection-report-pdf'
  AND "record_subject_type" = 'module'
  AND "record_subject_key" = 'inspections'
  AND "deleted_at" IS NULL;--> statement-breakpoint

ALTER TABLE "pdf_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_records" FORCE ROW LEVEL SECURITY;
