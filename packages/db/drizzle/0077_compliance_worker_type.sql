ALTER TABLE compliance_obligations
  ADD COLUMN IF NOT EXISTS worker_type text NOT NULL DEFAULT 'all';
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_obligations_worker_type_ck' AND conrelid = 'compliance_obligations'::regclass) THEN
    ALTER TABLE compliance_obligations ADD CONSTRAINT compliance_obligations_worker_type_ck
      CHECK (worker_type IN ('all', 'employee', 'contractor'));
  END IF;
END $$;
