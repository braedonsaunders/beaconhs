-- Clearcut the split global-built-in / tenant-custom reporting model. Every
-- tenant receives one editable AppKit definition per Beacon seed; existing
-- tenant-authored definitions remain intact.
ALTER TABLE "report_definitions" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "report_schedules" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "report_definitions" RENAME COLUMN "custom_query" TO "query";
--> statement-breakpoint
ALTER TABLE "report_definitions" ADD COLUMN "seed_key" text;
--> statement-breakpoint
ALTER TABLE "report_definitions" ADD COLUMN "state" text DEFAULT 'published' NOT NULL;
--> statement-breakpoint
ALTER TABLE "report_definitions" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE "report_definitions"
SET
  "category" = COALESCE(NULLIF("category", ''), 'general'),
  "layout" = COALESCE(
    "layout",
    '{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"}'::jsonb
  )
WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
DO $$
DECLARE
  invalid_custom integer;
BEGIN
  SELECT count(*) INTO invalid_custom
  FROM "report_definitions"
  WHERE "tenant_id" IS NOT NULL
    AND (
      "query" IS NULL
      OR jsonb_typeof("query") <> 'object'
      OR NULLIF("query"->>'entity', '') IS NULL
    );

  IF invalid_custom > 0 THEN
    RAISE EXCEPTION
      'AppKit report cutover blocked: % tenant-authored definition(s) have no valid query',
      invalid_custom;
  END IF;
END
$$;
--> statement-breakpoint
WITH seeds AS (
  SELECT *
  FROM jsonb_to_recordset('[{"schemaVersion":1,"seedKey":"incidents_weekly","slug":"incidents-weekly","name":"Weekly Incidents Summary","description":"Incidents in the current week, grouped by severity.","category":"incidents","query":{"entity":"incidents","mode":"rows","columns":["reference","title","severity","status","type","occurred_at"],"filters":{"combinator":"and","rules":[{"field":"occurred_at","op":"this_week"}]},"groupBy":"severity","sort":null,"sorts":[{"column":"occurred_at","direction":"desc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["incidents","beacon-default"]},{"schemaVersion":1,"seedKey":"corrective_actions_open","slug":"corrective-actions-open","name":"Open Corrective Actions","description":"Open, in-progress, and pending-verification corrective actions grouped by status.","category":"corrective_actions","query":{"entity":"corrective_actions","mode":"rows","columns":["reference","title","severity","status","owner_name","department_name","location_name","due_on","assigned_on","source"],"filters":{"combinator":"and","rules":[{"field":"status","op":"in","value":["open","in_progress","pending_verification"]}]},"groupBy":"status","sort":null,"sorts":[{"column":"due_on","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["corrective_actions","beacon-default"]},{"schemaVersion":1,"seedKey":"inspections_completed_weekly","slug":"inspections-completed-weekly","name":"Inspections Completed (weekly)","description":"Completed inspections in the current week, grouped by inspection type.","category":"inspections","query":{"entity":"inspection_records","mode":"rows","columns":["reference","status","occurred_at","location_on_site","type_id","site_org_unit_id"],"filters":{"combinator":"and","rules":[{"field":"status","op":"in","value":["submitted","closed"]},{"field":"occurred_at","op":"this_week"}]},"groupBy":"type_id","sort":null,"sorts":[{"column":"occurred_at","direction":"desc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["inspections","beacon-default"]},{"schemaVersion":1,"seedKey":"documents_overdue_review","slug":"documents-overdue-review","name":"Documents Overdue Review","description":"Published documents whose next review date has passed.","category":"documents","query":{"entity":"documents","mode":"rows","columns":["key","title","status","next_review_on"],"filters":{"combinator":"and","rules":[{"field":"status","op":"eq","value":"published"},{"field":"next_review_on","op":"before_now"}]},"groupBy":null,"sort":null,"sorts":[{"column":"next_review_on","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["documents","beacon-default"]},{"schemaVersion":1,"seedKey":"safety_kpi_monthly","slug":"safety-kpi-monthly","name":"Monthly Safety KPI Pack","description":"Monthly recordable incidents, DART incidents, and hours-worked safety rate inputs.","category":"cross_module","query":{"entity":"incident_rates","mode":"summarize","columns":[],"breakouts":[{"column":"month","bin":"month","label":"Month"}],"measures":[{"fn":"sum","column":"recordable_count","label":"Recordable incidents"},{"fn":"sum","column":"dart_count","label":"DART incidents"},{"fn":"sum","column":"hours_worked","label":"Hours worked"}],"filters":{"combinator":"and","rules":[{"field":"month","op":"this_year"}]},"groupBy":null,"sort":null,"sorts":null,"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["cross_module","beacon-default"]},{"schemaVersion":1,"seedKey":"site_safety_scorecard","slug":"site-safety-scorecard","name":"Site Safety Scorecard","description":"Incident activity by site for the current month.","category":"cross_module","query":{"entity":"incidents","mode":"summarize","columns":[],"breakouts":[{"column":"site_org_unit_id","label":"Site"}],"measures":[{"fn":"count","label":"Incidents"}],"filters":{"combinator":"and","rules":[{"field":"occurred_at","op":"this_month"}]},"groupBy":null,"sort":null,"sorts":null,"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["cross_module","beacon-default"]},{"schemaVersion":1,"seedKey":"overdue_everything","slug":"overdue-everything","name":"Overdue Items (All Modules)","description":"Current overdue compliance obligations from every module.","category":"cross_module","query":{"entity":"compliance_status","mode":"rows","columns":["source_module","obligation_title","person_name","status","period_start","period_end","due_on","percent"],"filters":{"combinator":"and","rules":[{"field":"status","op":"eq","value":"overdue"}]},"groupBy":"source_module","sort":null,"sorts":[{"column":"due_on","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["cross_module","beacon-default"]},{"schemaVersion":1,"seedKey":"lone_worker_weekly","slug":"lone-worker-weekly","name":"Weekly Monitored Sessions","description":"Monitored sessions started this week, grouped by session status.","category":"lone_worker","query":{"entity":"monitored_sessions","mode":"rows","columns":["subject_person_id","site_org_unit_id","monitor_status","created_at","last_checkin_at","next_checkin_due_at","expected_end_at"],"filters":{"combinator":"and","rules":[{"field":"created_at","op":"this_week"}]},"groupBy":"monitor_status","sort":null,"sorts":[{"column":"created_at","direction":"desc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["lone_worker","beacon-default"]},{"schemaVersion":1,"seedKey":"training_compliance_snapshot","slug":"training-compliance-snapshot","name":"Training Compliance Snapshot","description":"Current training compliance by obligation and employee.","category":"training","query":{"entity":"compliance_status","mode":"rows","columns":["obligation_title","person_name","status","due_on","count","expected","percent"],"filters":{"combinator":"and","rules":[{"field":"source_module","op":"in","value":["training","cert_requirement"]}]},"groupBy":"status","sort":null,"sorts":[{"column":"due_on","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["training","beacon-default"]},{"schemaVersion":1,"seedKey":"document_compliance_snapshot","slug":"document-compliance-snapshot","name":"Document Compliance Snapshot","description":"Current document acknowledgment compliance by obligation and employee.","category":"documents","query":{"entity":"compliance_status","mode":"rows","columns":["obligation_title","person_name","status","due_on","count","expected","percent"],"filters":{"combinator":"and","rules":[{"field":"source_module","op":"eq","value":"document"}]},"groupBy":"status","sort":null,"sorts":[{"column":"due_on","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["documents","beacon-default"]},{"schemaVersion":1,"seedKey":"incidents_trend_12m","slug":"incidents-trend-12m","name":"Incidents Trend (12 months)","description":"Monthly incident counts by severity over the rolling year.","category":"incidents","query":{"entity":"incidents","mode":"summarize","columns":[],"breakouts":[{"column":"occurred_at","bin":"month","label":"Month"},{"column":"severity","label":"Severity"}],"measures":[{"fn":"count","label":"Incidents"}],"filters":{"combinator":"and","rules":[{"field":"occurred_at","op":"between_days_ago","value":365}]},"groupBy":null,"sort":null,"sorts":null,"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["incidents","beacon-default"]},{"schemaVersion":1,"seedKey":"osha_300_log","slug":"osha-300-log","name":"OSHA 300 Recordable Log","description":"Recordable incident register for the rolling year.","category":"incidents","query":{"entity":"incidents","mode":"rows","columns":["reference","title","type","severity","status","occurred_at","actual_severity","potential_severity"],"filters":{"combinator":"and","rules":[{"field":"severity","op":"in","value":["medical_aid","lost_time","fatality"]},{"field":"occurred_at","op":"between_days_ago","value":365}]},"groupBy":null,"sort":null,"sorts":[{"column":"occurred_at","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["incidents","beacon-default"]},{"schemaVersion":1,"seedKey":"compliance_by_entity","slug":"compliance-by-entity","name":"Compliance — By Entity","description":"Every current subject covered by a compliance obligation.","category":"cross_module","query":{"entity":"compliance_status","mode":"rows","columns":["source_module","obligation_title","subject_key","status","count","expected","percent","period_start","period_end","due_on"],"filters":null,"groupBy":"obligation_title","sort":null,"sorts":[{"column":"due_on","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["cross_module","beacon-default"]},{"schemaVersion":1,"seedKey":"compliance_by_person","slug":"compliance-by-person","name":"Compliance — By Person","description":"Current compliance requirements grouped by employee across all modules.","category":"cross_module","query":{"entity":"compliance_status","mode":"rows","columns":["person_name","source_module","obligation_title","status","due_on","percent"],"filters":null,"groupBy":"person_name","sort":null,"sorts":[{"column":"due_on","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["cross_module","beacon-default"]},{"schemaVersion":1,"seedKey":"hazid_signatures","slug":"hazid-signatures","name":"Hazard ID — Signatures","description":"Hazard assessment signatures with signer, role, and signing time.","category":"hazid","query":{"entity":"hazid_signatures","mode":"rows","columns":["assessment_id","signature_type","person_id","external_name","signed_at"],"filters":null,"groupBy":"assessment_id","sort":null,"sorts":[{"column":"signed_at","direction":"desc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["hazid","beacon-default"]},{"schemaVersion":1,"seedKey":"training_certificates","slug":"training-certificates","name":"Training — Certificates","description":"Held training certificates. Filter people and courses; group by employee or course.","category":"training","query":{"entity":"training_matrix","mode":"rows","columns":["employee_no","person_name","department_name","course_code","course_name","course_type","delivery_type","completed_on","expires_on","coverage_status"],"filters":{"combinator":"and","rules":[{"field":"coverage_status","op":"neq","value":"missing"}]},"groupBy":"person_name","sort":null,"sorts":[{"column":"person_name","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["training","beacon-default"]},{"schemaVersion":1,"seedKey":"training_expired_upcoming","slug":"training-expired-upcoming","name":"Training — Expired & Upcoming","description":"Expired certificates and certificates expiring within 90 days. Group by employee or course.","category":"training","query":{"entity":"training_matrix","mode":"rows","columns":["employee_no","person_name","department_name","course_code","course_name","expires_on","coverage_status"],"filters":{"combinator":"and","rules":[{"field":"coverage_status","op":"in","value":["expired","expiring"]}]},"groupBy":"person_name","sort":null,"sorts":[{"column":"expires_on","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["training","beacon-default"]},{"schemaVersion":1,"seedKey":"training_missing","slug":"training-missing","name":"Training — Missing","description":"Required courses that are missing, expired, or expiring. Group by employee or course.","category":"training","query":{"entity":"training_matrix","mode":"rows","columns":["employee_no","person_name","department_name","course_code","course_name","coverage_status","expires_on"],"filters":{"combinator":"and","rules":[{"field":"is_required","op":"is_true"},{"field":"coverage_status","op":"in","value":["missing","expired","expiring"]}]},"groupBy":"person_name","sort":null,"sorts":[{"column":"person_name","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["training","beacon-default"]},{"schemaVersion":1,"seedKey":"skills_matrix","slug":"skills-matrix","name":"Skills — Matrix","description":"Externally issued skills and certifications grouped by issuing authority.","category":"training","query":{"entity":"skill_assignments","mode":"rows","columns":["employee_no","last_name","first_name","trade","authority","certification_code","certification_name","granted_on","expires_on","status"],"filters":null,"groupBy":"authority","sort":null,"sorts":[{"column":"last_name","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["training","beacon-default"]},{"schemaVersion":1,"seedKey":"skills_expired_upcoming","slug":"skills-expired-upcoming","name":"Skills — Expired & Upcoming","description":"Expired skills and skills expiring within 90 days.","category":"training","query":{"entity":"skill_assignments","mode":"rows","columns":["employee_no","last_name","first_name","authority","certification_code","certification_name","expires_on","status"],"filters":{"combinator":"and","rules":[{"field":"status","op":"in","value":["expired","expiring"]}]},"groupBy":"certification_name","sort":null,"sorts":[{"column":"expires_on","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["training","beacon-default"]},{"schemaVersion":1,"seedKey":"skills_missing","slug":"skills-missing","name":"Skills — Missing & Expired","description":"Missing or overdue externally issued skill obligations.","category":"training","query":{"entity":"compliance_status","mode":"rows","columns":["person_name","obligation_title","status","due_on","percent"],"filters":{"combinator":"and","rules":[{"field":"source_module","op":"eq","value":"cert_requirement"},{"field":"status","op":"in","value":["pending","overdue"]}]},"groupBy":"person_name","sort":null,"sorts":[{"column":"due_on","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["training","beacon-default"]},{"schemaVersion":1,"seedKey":"skills_cwb","slug":"skills-cwb","name":"Skills — CWB (Welding)","description":"Canadian Welding Bureau qualification roster.","category":"training","query":{"entity":"skill_assignments","mode":"rows","columns":["employee_no","last_name","first_name","trade","authority","certification_code","certification_name","cwb_standard","cwb_type","cwb_process","cwb_position","cwb_level","granted_on","expires_on","status"],"filters":{"combinator":"and","rules":[{"field":"authority","op":"contains","value":"CWB"}]},"groupBy":"certification_name","sort":null,"sorts":[{"column":"last_name","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["training","beacon-default"]},{"schemaVersion":1,"seedKey":"corrective_actions_list","slug":"corrective-actions-list","name":"Corrective Actions — List","description":"Every corrective action grouped by status and sorted by due date.","category":"corrective_actions","query":{"entity":"corrective_actions","mode":"rows","columns":["reference","title","severity","status","owner_name","department_name","location_name","due_on","assigned_on","source"],"filters":null,"groupBy":"status","sort":null,"sorts":[{"column":"due_on","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["corrective_actions","beacon-default"]},{"schemaVersion":1,"seedKey":"ppe_list","slug":"ppe-list","name":"PPE — List","description":"All active PPE items with serial, size, holder, status, and inspection dates.","category":"ppe","query":{"entity":"ppe_items","mode":"rows","columns":["serial_number","ppe_type","size","status","holder_name","department_name","last_inspection_on","next_inspection_due","next_annual_inspection_due","expires_on"],"filters":{"combinator":"and","rules":[{"field":"status","op":"in","value":["issued","in_stock"]}]},"groupBy":"status","sort":null,"sorts":[{"column":"serial_number","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["ppe","beacon-default"]},{"schemaVersion":1,"seedKey":"ppe_expired_upcoming","slug":"ppe-expired-upcoming","name":"PPE — Expired & Upcoming","description":"Active PPE whose annual inspection is overdue or due within 90 days.","category":"ppe","query":{"entity":"ppe_items","mode":"rows","columns":["serial_number","ppe_type","size","status","holder_name","department_name","last_inspection_on","next_annual_inspection_due"],"filters":{"combinator":"and","rules":[{"field":"status","op":"in","value":["issued","in_stock"]},{"field":"next_annual_inspection_due","op":"due_within_days","value":90}]},"groupBy":null,"sort":null,"sorts":[{"column":"next_annual_inspection_due","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["ppe","beacon-default"]},{"schemaVersion":1,"seedKey":"ppe_expiring","slug":"ppe-expiring","name":"PPE — Expiring soon","description":"Active PPE whose service life expires within 30 days.","category":"ppe","query":{"entity":"ppe_items","mode":"rows","columns":["serial_number","ppe_type","size","status","holder_name","expires_on"],"filters":{"combinator":"and","rules":[{"field":"status","op":"in","value":["issued","in_stock"]},{"field":"expires_on","op":"due_within_days","value":30}]},"groupBy":null,"sort":null,"sorts":[{"column":"expires_on","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["ppe","beacon-default"]},{"schemaVersion":1,"seedKey":"ppe_inspection_due","slug":"ppe-inspection-due","name":"PPE — Inspection due","description":"Active PPE whose pre-use inspection is overdue or due within 14 days.","category":"ppe","query":{"entity":"ppe_items","mode":"rows","columns":["serial_number","ppe_type","size","status","holder_name","last_inspection_on","next_inspection_due"],"filters":{"combinator":"and","rules":[{"field":"status","op":"in","value":["issued","in_stock"]},{"field":"next_inspection_due","op":"due_within_days","value":14}]},"groupBy":null,"sort":null,"sorts":[{"column":"next_inspection_due","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["ppe","beacon-default"]},{"schemaVersion":1,"seedKey":"vehicle_log_monthly","slug":"vehicle-log-monthly","name":"Vehicle Log — Monthly Summary","description":"Asset-by-month vehicle log summary with driver, distance, hours, crew, and source coverage.","category":"equipment","query":{"entity":"vehicle_log_monthly","mode":"rows","columns":["asset_tag","vehicle_name","driver_name","month","logged_days","business_km","personal_km","total_km","hours_on_site","manpower_count","imported_days","manual_days","site_count"],"filters":null,"groupBy":"asset_tag","sort":null,"sorts":[{"column":"month","direction":"asc"}],"limit":10000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["equipment","beacon-default"]},{"schemaVersion":1,"seedKey":"equipment_fleet","slug":"equipment-fleet","name":"Equipment — Fleet","description":"In-service assets with type, site, holder, usage, and next inspection.","category":"equipment","query":{"entity":"equipment_fleet","mode":"rows","columns":["asset_tag","name","equipment_type","status","site_name","holder_name","hours_ytd","km_ytd","last_inspection_on","next_inspection_due"],"filters":{"combinator":"and","rules":[{"field":"status","op":"eq","value":"in_service"}]},"groupBy":null,"sort":null,"sorts":[{"column":"asset_tag","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["equipment","beacon-default"]},{"schemaVersion":1,"seedKey":"equipment_inspections","slug":"equipment-inspections","name":"Equipment — Upcoming & overdue inspections","description":"Assets whose scheduled inspection is overdue or due within 30 days.","category":"equipment","query":{"entity":"equipment_fleet","mode":"rows","columns":["asset_tag","name","equipment_type","site_name","holder_name","last_inspection_on","next_inspection_due"],"filters":{"combinator":"and","rules":[{"field":"next_inspection_due","op":"due_within_days","value":30}]},"groupBy":null,"sort":null,"sorts":[{"column":"next_inspection_due","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["equipment","beacon-default"]},{"schemaVersion":1,"seedKey":"equipment_oil_change_due","slug":"equipment-oil-change-due","name":"Equipment — Upcoming & overdue oil changes","description":"Assets whose oil change is overdue or due within 30 days.","category":"equipment","query":{"entity":"equipment_fleet","mode":"rows","columns":["asset_tag","name","equipment_type","site_name","holder_name","last_oil_change_on","next_oil_change_due","oil_change_interval_months"],"filters":{"combinator":"and","rules":[{"field":"requires_oil_change","op":"is_true"},{"field":"next_oil_change_due","op":"due_within_days","value":30}]},"groupBy":null,"sort":null,"sorts":[{"column":"next_oil_change_due","direction":"asc"}],"limit":5000},"layout":{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"},"state":"published","tags":["equipment","beacon-default"]}]'::jsonb) AS seed(
    "seedKey" text,
    slug text,
    name text,
    description text,
    category text,
    query jsonb,
    layout jsonb,
    state text,
    tags jsonb
  )
)
INSERT INTO "report_definitions" (
  "tenant_id",
  "kind",
  "seed_key",
  "slug",
  "name",
  "description",
  "category",
  "query_kind",
  "query",
  "layout",
  "state",
  "tags"
)
SELECT
  tenant.id,
  'built_in'::"report_definition_kind",
  seed."seedKey",
  seed.slug,
  seed.name,
  seed.description,
  seed.category,
  'appkit',
  seed.query,
  seed.layout,
  seed.state,
  seed.tags
FROM "tenants" AS tenant
CROSS JOIN seeds AS seed
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "report_schedules" AS schedule
SET "definition_id" = replacement.id
FROM "report_definitions" AS legacy,
     "report_definitions" AS replacement
WHERE legacy.id = schedule."definition_id"
  AND legacy."tenant_id" IS NULL
  AND replacement."tenant_id" = schedule."tenant_id"
  AND (
    replacement."seed_key" = legacy.slug
    OR replacement.slug = replace(legacy.slug, '_', '-')
  );
--> statement-breakpoint
DO $$
DECLARE
  unmapped_schedules integer;
BEGIN
  SELECT count(*) INTO unmapped_schedules
  FROM "report_schedules" AS schedule
  JOIN "report_definitions" AS definition
    ON definition.id = schedule."definition_id"
  WHERE definition."tenant_id" IS NULL;

  IF unmapped_schedules > 0 THEN
    RAISE EXCEPTION
      'AppKit report cutover blocked: % schedule(s) still reference a global definition',
      unmapped_schedules;
  END IF;
END
$$;
--> statement-breakpoint
-- The retired scheduler accepted product-specific objects such as
-- {"days":30}. AppKit schedules use only the same recursive rule group as the
-- report compiler. Preserve already-native filters and clear incompatible
-- legacy options instead of allowing a scheduled run to fail later.
UPDATE "report_schedules"
SET "filters" = '{}'::jsonb
WHERE "filters" <> '{}'::jsonb
  AND (
    jsonb_typeof("filters") <> 'object'
    OR "filters"->>'combinator' NOT IN ('and', 'or')
    OR jsonb_typeof("filters"->'rules') <> 'array'
  );
--> statement-breakpoint
DELETE FROM "report_definitions" WHERE "tenant_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "report_schedules" DROP CONSTRAINT "report_schedules_definition_id_report_definitions_id_fk";
--> statement-breakpoint
DROP INDEX "report_definitions_builtin_slug_ux";
--> statement-breakpoint
DROP INDEX "report_definitions_tenant_kind_idx";
--> statement-breakpoint
DROP INDEX "report_definitions_tenant_slug_ux";
--> statement-breakpoint
ALTER TABLE "report_definitions" ALTER COLUMN "tenant_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "report_definitions" ALTER COLUMN "category" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "report_definitions" ALTER COLUMN "query" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "report_definitions" ALTER COLUMN "layout" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "report_definitions_tenant_seed_ux"
  ON "report_definitions" ("tenant_id", "seed_key")
  WHERE "seed_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "report_definitions_tenant_state_idx"
  ON "report_definitions" ("tenant_id", "state");
--> statement-breakpoint
CREATE UNIQUE INDEX "report_definitions_tenant_id_id_ux"
  ON "report_definitions" ("tenant_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "report_definitions_tenant_slug_ux"
  ON "report_definitions" ("tenant_id", "slug");
--> statement-breakpoint
ALTER TABLE "report_schedules"
  ADD CONSTRAINT "report_schedules_tenant_definition_fk"
  FOREIGN KEY ("tenant_id", "definition_id")
  REFERENCES "report_definitions" ("tenant_id", "id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "report_definitions" DROP COLUMN "kind";
--> statement-breakpoint
ALTER TABLE "report_definitions" DROP COLUMN "query_kind";
--> statement-breakpoint
DROP TYPE "public"."report_definition_kind";
--> statement-breakpoint
ALTER TABLE "report_definitions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "report_schedules" FORCE ROW LEVEL SECURITY;
