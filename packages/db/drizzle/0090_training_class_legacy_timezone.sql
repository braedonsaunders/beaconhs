-- Legacy training classes were imported with their local wall-clock stored as
-- UTC (the ETL set the legacy "7:30 AM" via setUTCHours), so every imported
-- class displays ~4-5 hours early in America/Toronto. Reinterpret the stored
-- UTC wall-clock as Toronto local time for exactly the ETL-imported classes
-- (identified through the etl.id_map crosswalk, source TRAININGCLASSES).
--
-- Idempotency: corrected class ids are recorded in
-- etl.training_class_tz_corrections and never shifted twice. Environments
-- without the ETL bookkeeping schema (fresh/CI databases) no-op. The derived
-- cancelled_at/completed_at the ETL copied from starts_at/ends_at are shifted
-- only where they still equal those source values.
DO $migration$
DECLARE
  tenant_row record;
  legacy_tz constant text := 'America/Toronto';
BEGIN
  IF to_regnamespace('etl') IS NULL OR to_regclass('etl.id_map') IS NULL THEN
    RETURN;
  END IF;

  CREATE TABLE IF NOT EXISTS etl.training_class_tz_corrections (
    class_id uuid PRIMARY KEY,
    corrected_at timestamptz NOT NULL DEFAULT now()
  );

  FOR tenant_row IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant_row.id::text, true);

    UPDATE training_classes c
    SET
      starts_at = (c.starts_at AT TIME ZONE 'UTC') AT TIME ZONE legacy_tz,
      ends_at = (c.ends_at AT TIME ZONE 'UTC') AT TIME ZONE legacy_tz,
      cancelled_at = CASE
        WHEN c.cancelled_at = c.starts_at
          THEN (c.cancelled_at AT TIME ZONE 'UTC') AT TIME ZONE legacy_tz
        ELSE c.cancelled_at
      END,
      completed_at = CASE
        WHEN c.completed_at = c.ends_at
          THEN (c.completed_at AT TIME ZONE 'UTC') AT TIME ZONE legacy_tz
        ELSE c.completed_at
      END,
      updated_at = now()
    WHERE c.tenant_id = tenant_row.id
      AND EXISTS (
        SELECT 1
        FROM etl.id_map m
        WHERE m.new_id = c.id
          AND m.tenant_id = tenant_row.id
          AND m.source_table = 'TRAININGCLASSES'
          AND m.entity_type = 'training_class'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM etl.training_class_tz_corrections x
        WHERE x.class_id = c.id
      );

    INSERT INTO etl.training_class_tz_corrections (class_id)
    SELECT c.id
    FROM training_classes c
    WHERE c.tenant_id = tenant_row.id
      AND EXISTS (
        SELECT 1
        FROM etl.id_map m
        WHERE m.new_id = c.id
          AND m.tenant_id = tenant_row.id
          AND m.source_table = 'TRAININGCLASSES'
          AND m.entity_type = 'training_class'
      )
    ON CONFLICT (class_id) DO NOTHING;
  END LOOP;

  PERFORM set_config('app.tenant_id', '', true);
END;
$migration$;
