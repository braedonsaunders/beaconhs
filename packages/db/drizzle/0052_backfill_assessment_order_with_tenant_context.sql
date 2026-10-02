-- Existing databases enforce RLS even for the migration owner. Backfill each
-- tenant explicitly; keep snapshots written by the current application intact.
DO $$
DECLARE
  tenant uuid;
  previous_tenant text := current_setting('app.tenant_id', true);
BEGIN
  FOR tenant IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant::text, true);
    WITH ordered AS (
      SELECT r.id, row_number() OVER (
        PARTITION BY r.assessment_id
        ORDER BY q.entity_order, r.created_at, r.id
      )::integer AS position
      FROM training_assessment_results r
      JOIN training_assessment_type_questions q
        ON q.tenant_id = r.tenant_id AND q.id = r.question_id
      WHERE r.tenant_id = tenant
    )
    UPDATE training_assessment_results r SET position_snapshot = o.position
    FROM ordered o
    WHERE r.tenant_id = tenant AND r.id = o.id AND r.position_snapshot = 0;

    IF EXISTS (
      SELECT 1 FROM training_assessment_results
      WHERE tenant_id = tenant AND position_snapshot = 0
    ) THEN
      RAISE EXCEPTION 'Assessment question-order backfill incomplete (tenant %)', tenant;
    END IF;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
END $$;
