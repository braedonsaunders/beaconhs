-- Hazard assessments use locking as their terminal submission. Cut existing
-- tenant flow graphs over to the canonical on_submit trigger so inspections,
-- journals, Builder apps, and hazard assessments share one completion event.
WITH migrated AS (
  SELECT
    "id",
    jsonb_set(
      "graph",
      '{nodes}',
      COALESCE(
        (
          SELECT jsonb_agg(
            CASE
              WHEN node #>> '{data,kind}' = 'trigger'
                AND node #>> '{data,trigger,trigger}' = 'on_lock'
              THEN jsonb_set(node, '{data,trigger,trigger}', '"on_submit"'::jsonb)
              ELSE node
            END
            ORDER BY ordinal
          )
          FROM jsonb_array_elements(COALESCE("graph" -> 'nodes', '[]'::jsonb))
            WITH ORDINALITY AS nodes(node, ordinal)
        ),
        '[]'::jsonb
      ),
      false
    ) AS next_graph
  FROM "form_automations"
  WHERE "subject_type" = 'module'
    AND "subject_key" = 'hazid'
)
UPDATE "form_automations" AS flow
SET "graph" = migrated.next_graph,
    "updated_at" = now()
FROM migrated
WHERE flow."id" = migrated."id"
  AND flow."graph" IS DISTINCT FROM migrated.next_graph;
