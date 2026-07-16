-- Master switch for the per-tenant compliance detection scan. Defaults to true
-- so every existing tenant keeps its current schedule; setting it false pauses
-- all automatic overdue/expiring reminders (and equipment-maintenance alerts)
-- for that tenant without discarding the configured cadence.
ALTER TABLE "tenant_notification_policy" ADD COLUMN IF NOT EXISTS "scan_enabled" boolean DEFAULT true NOT NULL;