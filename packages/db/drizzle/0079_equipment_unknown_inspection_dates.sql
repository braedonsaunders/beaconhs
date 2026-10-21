ALTER TABLE equipment_inspection_schedules ALTER COLUMN next_due_on DROP NOT NULL;
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    -- Unknown imported dates remain unknown; never manufacture an inspection deadline.
    WITH before_rows AS (
      SELECT id, last_completed_on, next_due_on FROM equipment_inspection_schedules
      WHERE tenant_id=t.id AND (last_completed_on<'1902-01-01' OR next_due_on<'1902-01-01')
      FOR UPDATE
    ), repaired AS (
      UPDATE equipment_inspection_schedules s SET
        last_completed_on=CASE WHEN b.last_completed_on<'1902-01-01' THEN NULL ELSE b.last_completed_on END,
        next_due_on=CASE WHEN b.next_due_on<'1902-01-01' THEN NULL ELSE b.next_due_on END,
        updated_at=now()
      FROM before_rows b WHERE s.tenant_id=t.id AND s.id=b.id
      RETURNING s.id,s.equipment_item_id,s.last_completed_on,s.next_due_on
    )
    INSERT INTO audit_log(tenant_id,entity_type,entity_id,action,summary,before,after,metadata)
    SELECT t.id,'equipment',r.equipment_item_id,'update','Cleared unknown inspection date placeholders; schedule retained',
      jsonb_build_object('scheduleId',b.id,'lastCompletedOn',b.last_completed_on,'nextDueOn',b.next_due_on),
      jsonb_build_object('scheduleId',r.id,'lastCompletedOn',r.last_completed_on,'nextDueOn',r.next_due_on),
      jsonb_build_object('migration','0079_equipment_unknown_inspection_dates','repair','unknown-equipment-inspection-dates')
    FROM repaired r JOIN before_rows b ON b.id=r.id;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE equipment_inspection_schedules ADD CONSTRAINT equipment_inspection_schedules_due_date_ck CHECK (next_due_on IS NULL OR next_due_on >= '1902-01-01');
ALTER TABLE equipment_inspection_schedules ADD CONSTRAINT equipment_inspection_schedules_completed_date_ck CHECK (last_completed_on IS NULL OR last_completed_on >= '1902-01-01');
