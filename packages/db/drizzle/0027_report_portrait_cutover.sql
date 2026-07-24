UPDATE "report_definitions"
SET
  "layout" = jsonb_set(
    COALESCE("layout", '{}'::jsonb),
    '{orientation}',
    '"portrait"'::jsonb,
    true
  ),
  "updated_at" = now()
WHERE "seed_key" IS NOT NULL
  AND "tags" @> '["beacon-default"]'::jsonb
  AND "layout"->>'orientation' IS DISTINCT FROM 'portrait';
