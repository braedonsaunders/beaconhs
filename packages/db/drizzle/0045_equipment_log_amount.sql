ALTER TABLE equipment_log_entries ADD COLUMN IF NOT EXISTS amount numeric(18, 2);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'equipment_log_entries'::regclass
      AND conname = 'equipment_log_entries_maintenance_amount_check'
  ) THEN
    ALTER TABLE equipment_log_entries ADD CONSTRAINT equipment_log_entries_maintenance_amount_check
      CHECK (amount IS NULL OR kind = 'maintenance');
  END IF;
END $$;
