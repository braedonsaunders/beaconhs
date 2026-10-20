CREATE TABLE IF NOT EXISTS compliance_period_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  obligation_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  period_start_at timestamptz NOT NULL,
  period_end_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  timezone text NOT NULL,
  rule jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compliance_period_snapshots_obligation_fk FOREIGN KEY (tenant_id, obligation_id)
    REFERENCES compliance_obligations(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT compliance_period_snapshots_valid_period CHECK (period_end_at > period_start_at AND period_end >= period_start)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS compliance_period_snapshots_period_ux
  ON compliance_period_snapshots (tenant_id, obligation_id, period_start_at, period_end_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS compliance_period_snapshots_history_idx
  ON compliance_period_snapshots (tenant_id, obligation_id, period_end_at);
