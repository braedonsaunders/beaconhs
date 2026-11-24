-- A maintenance plan's completion baseline (last_readings) now holds readings
-- only for the meters its usage conditions count on. Legacy and earlier
-- completions also stored readings for unrelated meters, so calendar-only oil
-- changes on units whose hour meter was later replaced or re-based were
-- rejected as "below the previous completion reading". Drop those keys. Plans
-- carry tenant RLS, so each tenant is updated in its own context.
DO $$
DECLARE
  tenant uuid;
  previous_tenant text := current_setting('app.tenant_id', true);
BEGIN
  FOR tenant IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant::text, true);
    WITH migrated AS (
      SELECT
        plan."id",
        COALESCE(
          (
            SELECT jsonb_object_agg(reading.key, reading.value)
            FROM jsonb_each(plan."last_readings") AS reading(key, value)
            WHERE EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(plan."rules", '[]'::jsonb)) AS rule(value)
              WHERE rule.value ->> 'kind' = 'meter'
                AND rule.value ->> 'meter' = reading.key
            )
          ),
          '{}'::jsonb
        ) AS next_readings
      FROM "equipment_service_plans" AS plan
      WHERE plan."tenant_id" = tenant
        AND plan."last_readings" <> '{}'::jsonb
    )
    UPDATE "equipment_service_plans" AS plan
    SET "last_readings" = migrated.next_readings,
        "updated_at" = now()
    FROM migrated
    WHERE plan."id" = migrated."id"
      AND plan."last_readings" IS DISTINCT FROM migrated.next_readings;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
END $$;
