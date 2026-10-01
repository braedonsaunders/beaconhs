-- Vehicle logs record driver mileage, not labour hours or crew attendance.
-- These projections depend on the retired columns and are recreated by the
-- normal reporting-view installer after all migrations complete.
DROP VIEW IF EXISTS report_vehicle_log_monthly;
--> statement-breakpoint
DROP VIEW IF EXISTS report_vehicle_log_entries;
--> statement-breakpoint
DROP VIEW IF EXISTS report_equipment_fleet;
--> statement-breakpoint
ALTER TABLE truck_log_entries DROP COLUMN IF EXISTS hours_on_site;
--> statement-breakpoint
ALTER TABLE truck_log_entries DROP COLUMN IF EXISTS manpower_count;
--> statement-breakpoint
-- Migrate saved column selections so the editable seeded reports remain valid.
-- Do not silently broaden a report whose filters or calculations use a removed
-- field: such a configuration needs an explicit edit before this cutover.
ALTER TABLE report_definitions NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM report_definitions
    WHERE "query"->>'entity' IN ('vehicle_log_entries', 'vehicle_log_monthly', 'equipment_fleet')
      AND ("query" - 'columns')::text ~ '"(hours_on_site|manpower_count|hours_ytd|hours_total)"'
  ) THEN
    RAISE EXCEPTION 'Vehicle-log field removal blocked: edit report filters or calculations referencing hours or crew first';
  END IF;
END $$;
--> statement-breakpoint
UPDATE report_definitions d
SET "query" = jsonb_set(d."query", '{columns}', (
      SELECT coalesce(jsonb_agg(c.value ORDER BY c.ordinality), '[]'::jsonb)
      FROM jsonb_array_elements(d."query"->'columns') WITH ORDINALITY AS c(value, ordinality)
      WHERE c.value #>> '{}' NOT IN ('hours_on_site', 'manpower_count', 'hours_ytd', 'hours_total')
    )),
    updated_at = now()
WHERE d."query"->>'entity' IN ('vehicle_log_entries', 'vehicle_log_monthly', 'equipment_fleet')
  AND d."query"->'columns' ?| ARRAY['hours_on_site', 'manpower_count', 'hours_ytd', 'hours_total'];
--> statement-breakpoint
UPDATE report_definitions
SET description = 'Asset-by-month vehicle log summary with driver, distance and source coverage.',
    updated_at = now()
WHERE seed_key = 'vehicle_log_monthly'
  AND description = 'Asset-by-month vehicle log summary with driver, distance, hours, crew, and source coverage.';
--> statement-breakpoint
ALTER TABLE report_definitions FORCE ROW LEVEL SECURITY;
