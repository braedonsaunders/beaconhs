INSERT INTO "report_definitions" (
  "id",
  "tenant_id",
  "kind",
  "slug",
  "name",
  "description",
  "category",
  "query_kind",
  "custom_query",
  "created_at",
  "updated_at"
)
VALUES (
  gen_random_uuid(),
  NULL,
  'built_in',
  'legacy_vehicle_log_monthly',
  'Vehicle Log - Monthly Summary',
  'Asset-by-month vehicle log summary with driver, km, hours, crew counts, import coverage, and site counts. Uses the native report engine over the vehicle-log monthly reporting view.',
  'equipment',
  'custom_query',
  '{
    "entity": "vehicle_log_monthly",
    "mode": "rows",
    "columns": [
      "asset_tag",
      "vehicle_name",
      "driver_name",
      "month",
      "logged_days",
      "business_km",
      "personal_km",
      "total_km",
      "hours_on_site",
      "manpower_count",
      "imported_days",
      "manual_days",
      "site_count"
    ],
    "groupBy": "asset_tag",
    "sort": { "column": "month", "direction": "asc" },
    "limit": 10000
  }'::jsonb,
  now(),
  now()
)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = excluded."name",
  "description" = excluded."description",
  "category" = excluded."category",
  "query_kind" = excluded."query_kind",
  "custom_query" = excluded."custom_query",
  "updated_at" = now();
