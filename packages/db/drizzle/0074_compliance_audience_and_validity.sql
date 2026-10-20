ALTER TABLE compliance_audience ADD COLUMN IF NOT EXISTS excluded boolean NOT NULL DEFAULT false;
--> statement-breakpoint
DROP INDEX IF EXISTS compliance_audience_unique_ux;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS compliance_audience_unique_ux ON compliance_audience (tenant_id, obligation_id, kind, entity_key, excluded);
--> statement-breakpoint
ALTER TYPE compliance_status_value ADD VALUE IF NOT EXISTS 'booked';
--> statement-breakpoint
DO $migration$
DECLARE tenant_row record; obligation_row record; next_recurrence jsonb;
BEGIN
  FOR tenant_row IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant_row.id::text, true);
    FOR obligation_row IN SELECT id, recurrence FROM compliance_obligations
      WHERE tenant_id = tenant_row.id AND deleted_at IS NULL AND source_module = 'training'
        AND recurrence->>'kind' = 'frequency' AND recurrence->>'frequency' = 'year'
        AND NOT (recurrence ? 'evidenceWindow')
        AND coalesce(recurrence->>'cron', '0 8 1 1 *') = '0 8 1 1 *'
    LOOP
      next_recurrence := (obligation_row.recurrence - 'cron' - 'dueOffsetDays' - 'dueOffsetMinutes') || '{"evidenceWindow":"rolling"}'::jsonb;
      UPDATE compliance_obligations SET recurrence = next_recurrence, last_scanned_at = NULL, next_due_at = NULL, updated_at = now()
        WHERE tenant_id = tenant_row.id AND id = obligation_row.id;
      INSERT INTO audit_log (tenant_id, entity_type, entity_id, action, summary, before, after)
        VALUES (tenant_row.id, 'compliance_obligation', obligation_row.id, 'update',
          'Corrected annual training to a rolling 12-month completion window',
          jsonb_build_object('recurrence', obligation_row.recurrence), jsonb_build_object('recurrence', next_recurrence));
      UPDATE compliance_dispatches SET status = 'skipped', error = 'Superseded by rolling training validity', publish_lease_id = NULL, publish_claimed_at = NULL
        WHERE tenant_id = tenant_row.id AND obligation_id = obligation_row.id AND status = 'queued';
    END LOOP;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END;
$migration$;
