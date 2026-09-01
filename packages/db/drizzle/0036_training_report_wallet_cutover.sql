-- Training report cutover:
-- 1) Wallet-card PDF is the designed CR80 fronts (layout.exportMode).
-- 2) Employment status is a visible filter on seeded training-matrix reports.

UPDATE "report_definitions"
SET
  "layout" = jsonb_set(COALESCE("layout", '{}'::jsonb), '{exportMode}', '"credential-fronts"'),
  "description" = 'Latest certificates you can filter, then print as CR80 wallet-card fronts.'
WHERE "seed_key" = 'training_wallet_cards';
--> statement-breakpoint

UPDATE "report_definitions"
SET "query" = jsonb_set(
  "query",
  '{filters}',
  CASE
    WHEN "query" -> 'filters' IS NULL OR "query" -> 'filters' = 'null'::jsonb THEN
      '{"combinator":"and","rules":[{"field":"person_status","op":"eq","value":"active"}]}'::jsonb
    WHEN "query" #>> '{filters,combinator}' = 'and'
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE("query" -> 'filters' -> 'rules', '[]'::jsonb)) AS rule
        WHERE rule ->> 'field' = 'person_status'
      )
    THEN jsonb_set(
      "query" -> 'filters',
      '{rules}',
      (COALESCE("query" -> 'filters' -> 'rules', '[]'::jsonb)
        || '[{"field":"person_status","op":"eq","value":"active"}]'::jsonb)
    )
    ELSE "query" -> 'filters'
  END
)
WHERE "query" ->> 'entity' = 'training_matrix';
