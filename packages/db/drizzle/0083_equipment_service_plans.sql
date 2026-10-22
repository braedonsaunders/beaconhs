-- Recurring service plans use independent calendar / usage rules and retain cycle evidence.
CREATE TABLE IF NOT EXISTS equipment_meters (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 equipment_item_id uuid NOT NULL, name text NOT NULL, unit text NOT NULL,
 current_value numeric(16,3), read_on date, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT equipment_meters_tenant_id_id_ux UNIQUE(tenant_id,id),
 CONSTRAINT equipment_meters_tenant_item_fk FOREIGN KEY(tenant_id,equipment_item_id) REFERENCES equipment_items(tenant_id,id) ON DELETE CASCADE,
 CONSTRAINT equipment_meters_value_ck CHECK(current_value IS NULL OR current_value>=0)
);
CREATE INDEX IF NOT EXISTS equipment_meters_item_idx ON equipment_meters(tenant_id,equipment_item_id);
CREATE TABLE IF NOT EXISTS equipment_service_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 equipment_item_id uuid NOT NULL, name text NOT NULL, notes text, category text, rules jsonb NOT NULL,
 last_readings jsonb NOT NULL DEFAULT '{}', match text NOT NULL DEFAULT 'any', last_completed_on date, is_active boolean NOT NULL DEFAULT true,
 cycle_id uuid NOT NULL DEFAULT gen_random_uuid(), notified_cycle_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT equipment_service_plans_tenant_id_id_ux UNIQUE(tenant_id,id),
 CONSTRAINT equipment_service_plans_tenant_item_fk FOREIGN KEY(tenant_id,equipment_item_id) REFERENCES equipment_items(tenant_id,id) ON DELETE CASCADE,
 CONSTRAINT equipment_service_plans_match_ck CHECK(match IN ('any','all')),
 CONSTRAINT equipment_service_plans_rules_ck CHECK(jsonb_typeof(rules)='array' AND jsonb_array_length(rules) BETWEEN 1 AND 12)
);
CREATE INDEX IF NOT EXISTS equipment_service_plans_item_idx ON equipment_service_plans(tenant_id,equipment_item_id);
ALTER TABLE equipment_maintenance_dispatches ADD COLUMN IF NOT EXISTS service_cycles jsonb NOT NULL DEFAULT '[]';
-- FORCE RLS applies to the migration owner: backfill each tenant in its own context.
DO $$ DECLARE tenant uuid; BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='equipment_items' AND column_name='requires_oil_change') THEN
 FOR tenant IN SELECT id FROM tenants LOOP
  PERFORM set_config('app.tenant_id',tenant::text,true);
  INSERT INTO equipment_service_plans(tenant_id,equipment_item_id,name,category,rules,last_completed_on,last_readings,is_active,notes)
  SELECT e.tenant_id,e.id,'Engine oil change','oil_change',
    jsonb_build_array(jsonb_build_object('kind','calendar','every',e.oil_change_interval_months,'unit','month','dueOn',e.next_oil_change_due)),
    e.last_oil_change_on, CASE WHEN jsonb_typeof(e.metadata->'lastOilHours')='number' THEN jsonb_build_object('engine_hours',e.metadata->'lastOilHours') ELSE '{}'::jsonb END,e.requires_oil_change,
    CASE WHEN e.oil_change_interval_months IS NULL THEN 'Imported oil-change tracking has no known interval. Confirm the interval before activating or recording completion.' ELSE NULL END
  FROM equipment_items e
  WHERE e.tenant_id=tenant AND (e.requires_oil_change OR e.last_oil_change_on IS NOT NULL OR e.next_oil_change_due IS NOT NULL)
    AND NOT EXISTS(SELECT 1 FROM equipment_service_plans s WHERE s.tenant_id=e.tenant_id AND s.equipment_item_id=e.id AND s.category='oil_change');
  -- Suppress already-due imported cycles only. Future work must still receive
  -- its normal first reminder when it becomes due.
  UPDATE equipment_service_plans SET notified_cycle_id=cycle_id
   WHERE tenant_id=tenant AND category='oil_change' AND notified_cycle_id IS NULL
     AND (rules->0->>'dueOn')::date <=
       (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(
         (SELECT NULLIF(btrim(scan_timezone),'') FROM tenant_notification_policy WHERE tenant_id=tenant LIMIT 1),'UTC'))::date;
 END LOOP;
 END IF;
END $$;
-- Existing already-due oil tracking does not produce a catch-up batch.
DROP VIEW IF EXISTS report_equipment_fleet;
ALTER TABLE equipment_items DROP COLUMN IF EXISTS requires_oil_change, DROP COLUMN IF EXISTS oil_change_interval_months, DROP COLUMN IF EXISTS last_oil_change_on, DROP COLUMN IF EXISTS next_oil_change_due;
