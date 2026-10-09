ALTER TABLE equipment_location_history ADD COLUMN IF NOT EXISTS movement_kind text NOT NULL DEFAULT 'transfer';
ALTER TABLE equipment_location_history ADD COLUMN IF NOT EXISTS condition text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_location_history_movement_kind_ck' AND conrelid = 'equipment_location_history'::regclass) THEN
    ALTER TABLE equipment_location_history ADD CONSTRAINT equipment_location_history_movement_kind_ck CHECK (movement_kind IN ('check_in','check_out','transfer'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_location_history_condition_ck' AND conrelid = 'equipment_location_history'::regclass) THEN
    ALTER TABLE equipment_location_history ADD CONSTRAINT equipment_location_history_condition_ck CHECK (condition IN ('good','fair','damaged','unusable'));
  END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    UPDATE equipment_location_history SET movement_kind = CASE
      WHEN lower(note) LIKE 'checked in%' THEN 'check_in'
      WHEN lower(note) LIKE 'checked out%' THEN 'check_out'
      ELSE 'transfer' END,
      condition = lower(substring(note from '(?i)^checked in \((good|fair|damaged|unusable)\)'))
    WHERE tenant_id = t.id;
    UPDATE equipment_items e SET is_available_for_checkout =
      e.status = 'in_service' AND NOT e.is_missing AND e.deleted_at IS NULL
      AND e.current_holder_person_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM equipment_checkouts co
        WHERE co.tenant_id = e.tenant_id AND co.equipment_item_id = e.id AND co.returned_at IS NULL)
      AND (e.current_site_org_unit_id IS NULL OR EXISTS (
        SELECT 1 FROM org_units location WHERE location.tenant_id = e.tenant_id
          AND location.id = e.current_site_org_unit_id AND location.deleted_at IS NULL
          AND (location.is_equipment_base OR EXISTS (
            SELECT 1 FROM equipment_station_settings station WHERE station.tenant_id = e.tenant_id
              AND station.default_check_in_org_unit_id = location.id))))
    WHERE e.tenant_id = t.id;
  END LOOP;
END $$;
