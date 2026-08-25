-- Compliance audiences can target people groups and crews. PPE report view
-- exposes last annual inspection and holder employment fields so reports can
-- exclude inactive people.

ALTER TYPE "compliance_audience_kind" ADD VALUE IF NOT EXISTS 'person_group';--> statement-breakpoint
ALTER TYPE "compliance_audience_kind" ADD VALUE IF NOT EXISTS 'crew';--> statement-breakpoint

CREATE OR REPLACE VIEW report_ppe_items AS
SELECT
  item.id,
  item.tenant_id,
  item.type_id,
  type.name AS ppe_type,
  item.serial_number,
  item.size,
  item.status,
  item.is_draft,
  item.current_holder_person_id,
  CASE WHEN holder.id IS NULL THEN NULL
       ELSE holder.last_name || ', ' || holder.first_name END AS holder_name,
  holder.status AS holder_status,
  holder.employee_no AS holder_employee_no,
  holder.department_id,
  department.name AS department_name,
  array_to_string(
    ARRAY(
      SELECT membership.group_id::text
      FROM person_group_memberships membership
      WHERE membership.tenant_id = item.tenant_id
        AND membership.person_id = holder.id
      ORDER BY membership.group_id
    ),
    ','
  ) AS group_id_list,
  item.last_inspection_on,
  item.next_inspection_due,
  item.last_annual_inspection_on,
  item.next_annual_inspection_due,
  item.purchase_date,
  item.expires_on,
  item.metadata,
  item.deleted_at
FROM ppe_items item
JOIN ppe_types type
  ON type.id = item.type_id AND type.tenant_id = item.tenant_id
LEFT JOIN people holder
  ON holder.id = item.current_holder_person_id AND holder.tenant_id = item.tenant_id
LEFT JOIN departments department
  ON department.id = holder.department_id AND department.tenant_id = item.tenant_id;
--> statement-breakpoint

-- Deploy migrates and does not re-seed. Insert the new wallet-card report
-- for every tenant that does not already have that seed, and repair the
-- product PPE expired/upcoming definition when it is still the original
-- seed query or still has the empty holder-id filter that hid every row.
ALTER TABLE "report_definitions" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO "report_definitions" (
  "tenant_id",
  "seed_key",
  "slug",
  "name",
  "description",
  "category",
  "query",
  "layout",
  "state",
  "tags"
)
SELECT
  tenant.id,
  'training_wallet_cards',
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM "report_definitions" AS conflict
      WHERE conflict."tenant_id" = tenant.id
        AND conflict."slug" = 'training-wallet-cards'
    )
      THEN 'training-wallet-cards-' || left(gen_random_uuid()::text, 8)
    ELSE 'training-wallet-cards'
  END,
  'Training — Wallet cards',
  'Latest certificates you can filter, then print as wallet-card PDFs.',
  'training',
  '{
    "entity":"training_matrix",
    "mode":"rows",
    "columns":["employee_no","person_name","department_name","course_code","course_name","completed_on","expires_on","coverage_status"],
    "filters":{"combinator":"and","rules":[{"field":"coverage_status","op":"in","value":["valid","expiring"]}]},
    "groupBy":"person_name",
    "sort":null,
    "sorts":[{"column":"person_name","direction":"asc"}],
    "limit":5000
  }'::jsonb,
  '{"paperSize":"letter","orientation":"landscape","marginMm":15,"showSummary":true,"density":"standard"}'::jsonb,
  'published',
  '["training","beacon-default"]'::jsonb
FROM "tenants" AS tenant
WHERE NOT EXISTS (
  SELECT 1
  FROM "report_definitions" AS existing
  WHERE existing."tenant_id" = tenant.id
    AND existing."seed_key" = 'training_wallet_cards'
);
--> statement-breakpoint

UPDATE "report_definitions"
SET
  "query" = '{
    "entity":"ppe_items",
    "mode":"rows",
    "columns":["serial_number","ppe_type","size","status","holder_name","holder_status","department_name","last_inspection_on","last_annual_inspection_on","next_annual_inspection_due"],
    "filters":{
      "combinator":"and",
      "rules":[
        {"field":"status","op":"in","value":["issued","in_stock"]},
        {"field":"is_draft","op":"is_false"},
        {"field":"holder_status","op":"eq","value":"active"},
        {"field":"next_annual_inspection_due","op":"due_within_days","value":90}
      ]
    },
    "groupBy":null,
    "sort":null,
    "sorts":[{"column":"next_annual_inspection_due","direction":"asc"}],
    "limit":5000
  }'::jsonb,
  "updated_at" = now()
WHERE "seed_key" = 'ppe_expired_upcoming'
  AND (
    "query" = '{
      "entity":"ppe_items",
      "mode":"rows",
      "columns":["serial_number","ppe_type","size","status","holder_name","department_name","last_inspection_on","next_annual_inspection_due"],
      "filters":{"combinator":"and","rules":[{"field":"status","op":"in","value":["issued","in_stock"]},{"field":"next_annual_inspection_due","op":"due_within_days","value":90}]},
      "groupBy":null,
      "sort":null,
      "sorts":[{"column":"next_annual_inspection_due","direction":"asc"}],
      "limit":5000
    }'::jsonb
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE("query"#>'{filters,rules}', '[]'::jsonb)) AS rule
      WHERE rule->>'field' = 'current_holder_person_id'
        AND rule->>'op' = 'in'
        AND COALESCE(jsonb_array_length(rule->'value'), 0) = 0
    )
  );
--> statement-breakpoint
ALTER TABLE "report_definitions" FORCE ROW LEVEL SECURITY;
