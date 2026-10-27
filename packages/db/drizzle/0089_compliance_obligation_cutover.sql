-- Correct calendar quantity deadlines for inspections and hazard assessments,
-- and move every document acknowledgement obligation to the latest edition.
DO $migration$
DECLARE tenant_row record; obligation_row record; next_recurrence jsonb; deadline jsonb;
BEGIN
  FOR tenant_row IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant_row.id::text, true);

    FOR obligation_row IN
      SELECT id, source_module, recurrence
      FROM compliance_obligations
      WHERE tenant_id = tenant_row.id AND deleted_at IS NULL
        AND source_module IN ('inspection', 'hazard_assessment')
        AND recurrence->>'kind' = 'frequency'
        AND NOT (recurrence ? 'deadline')
        AND coalesce((recurrence->>'dueOffsetDays')::integer, 0) = 0
        AND coalesce((recurrence->>'dueOffsetMinutes')::integer, 0) = 0
        AND coalesce(recurrence->>'cron', '') IN ('', CASE recurrence->>'frequency'
          WHEN 'day' THEN '0 8 * * *' WHEN 'week' THEN '0 8 * * 1'
          WHEN 'month' THEN '0 8 1 * *' WHEN 'quarter' THEN '0 8 1 */3 *'
          WHEN 'year' THEN '0 8 1 1 *' END)
    LOOP
      deadline := CASE obligation_row.recurrence->>'frequency'
        WHEN 'day' THEN '{"time":"23:59"}'::jsonb
        WHEN 'week' THEN '{"weekday":7,"time":"23:59"}'::jsonb
        WHEN 'month' THEN '{"day":31,"time":"23:59"}'::jsonb
        WHEN 'quarter' THEN '{"month":3,"day":31,"time":"23:59"}'::jsonb
        WHEN 'year' THEN '{"month":12,"day":31,"time":"23:59"}'::jsonb END;
      IF deadline IS NULL THEN CONTINUE; END IF;
      next_recurrence := (obligation_row.recurrence - 'cron' - 'dueOffsetDays' - 'dueOffsetMinutes')
        || jsonb_build_object('evidenceWindow', 'calendar', 'deadline', deadline);
      UPDATE compliance_obligations
        SET recurrence=next_recurrence, last_scanned_at=NULL, next_due_at=NULL, updated_at=now()
        WHERE tenant_id=tenant_row.id AND id=obligation_row.id;
      INSERT INTO audit_log (tenant_id, entity_type, entity_id, action, summary, before, after)
        VALUES (tenant_row.id, 'compliance_obligation', obligation_row.id, 'update',
          'Moved inspection or hazard assessment deadline to the end of its calendar period',
          jsonb_build_object('recurrence', obligation_row.recurrence),
          jsonb_build_object('recurrence', next_recurrence));
      UPDATE compliance_dispatches SET status='skipped', error='Superseded by corrected calendar deadline', publish_lease_id=NULL, publish_claimed_at=NULL
        WHERE tenant_id=tenant_row.id AND obligation_id=obligation_row.id AND status='queued';
    END LOOP;

    FOR obligation_row IN
      SELECT id, target_ref, recurrence FROM compliance_obligations
      WHERE tenant_id=tenant_row.id AND deleted_at IS NULL
        AND source_module='document'
        AND (target_ref ? 'documentVersionId' OR (recurrence->>'kind'='frequency' AND NOT (recurrence ? 'evidenceWindow')))
    LOOP
      UPDATE compliance_obligations
        SET target_ref=target_ref - 'documentVersionId',
            recurrence=CASE WHEN obligation_row.recurrence->>'kind'='frequency' AND NOT (obligation_row.recurrence ? 'evidenceWindow')
              THEN obligation_row.recurrence || jsonb_build_object('evidenceWindow','rolling') ELSE recurrence END,
            last_scanned_at=NULL,
            next_due_at=NULL, updated_at=now()
        WHERE tenant_id=tenant_row.id AND id=obligation_row.id;
      INSERT INTO audit_log (tenant_id, entity_type, entity_id, action, summary, before, after)
        VALUES (tenant_row.id, 'compliance_obligation', obligation_row.id, 'update',
          'Switched document acknowledgement to the latest published edition',
          jsonb_build_object('targetRef', obligation_row.target_ref, 'recurrence', obligation_row.recurrence),
          jsonb_build_object('targetRef', obligation_row.target_ref - 'documentVersionId',
            'recurrence', CASE WHEN obligation_row.recurrence->>'kind'='frequency' AND NOT (obligation_row.recurrence ? 'evidenceWindow')
              THEN obligation_row.recurrence || jsonb_build_object('evidenceWindow','rolling') ELSE obligation_row.recurrence END));
    END LOOP;
  END LOOP;
  PERFORM set_config('app.tenant_id','',true);
END;
$migration$;
