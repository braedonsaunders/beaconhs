-- Upgraded environments already FORCE RLS on these tenant tables. The
-- migration runner assumes their NOLOGIN owner role, so relax FORCE only for
-- this transaction while promoting the legacy JSON value and reconciling the
-- canonical seeded PDF.
ALTER TABLE "inspection_records" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pdf_templates" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "inspection_records"
  ADD COLUMN IF NOT EXISTS "location" text;--> statement-breakpoint

UPDATE "inspection_records"
SET "location" = NULLIF(btrim("metadata"->>'locationOnSite'), '')
WHERE "location" IS NULL
  AND NULLIF(btrim("metadata"->>'locationOnSite'), '') IS NOT NULL;--> statement-breakpoint

-- Clean cutover: locationOnSite has one canonical home after the backfill.
UPDATE "inspection_records"
SET "metadata" = "metadata" - 'locationOnSite'
WHERE "metadata" ? 'locationOnSite';--> statement-breakpoint

-- Existing seeded inspection PDFs used the org-unit Site token in the slot
-- intended for the specific inspection location. Update only the canonical
-- seeded template key; tenant-created templates are untouched.
UPDATE "pdf_templates"
SET "source_html" = regexp_replace(
      "source_html",
      '>Site</td>(<td[^>]*>)\{\{site_name\}\}</td>',
      '>Location</td>\1{{location}}</td>'
    ),
    "compiled_html" = regexp_replace(
      "compiled_html",
      '>Site</td>(<td[^>]*>)\{\{site_name\}\}</td>',
      '>Location</td>\1{{location}}</td>'
    ),
    "updated_at" = now()
WHERE "key" = 'inspection-report-pdf'
  AND "record_subject_type" = 'module'
  AND "record_subject_key" = 'inspections'
  AND "deleted_at" IS NULL;--> statement-breakpoint

ALTER TABLE "pdf_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_records" FORCE ROW LEVEL SECURITY;
