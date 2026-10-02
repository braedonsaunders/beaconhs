ALTER TABLE training_assessment_results ADD COLUMN IF NOT EXISTS position_snapshot integer NOT NULL DEFAULT 0;
--> statement-breakpoint
WITH ordered AS (
  SELECT r.id, row_number() OVER (PARTITION BY r.tenant_id, r.assessment_id ORDER BY q.entity_order, r.created_at, r.id)::integer AS position
  FROM training_assessment_results r
  JOIN training_assessment_type_questions q ON q.tenant_id=r.tenant_id AND q.id=r.question_id
)
UPDATE training_assessment_results r SET position_snapshot=o.position
FROM ordered o WHERE r.id=o.id AND r.position_snapshot=0;
