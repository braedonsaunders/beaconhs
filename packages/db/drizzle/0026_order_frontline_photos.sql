ALTER TABLE "inspection_record_attachments"
  ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;
ALTER TABLE "hazid_assessment_photos"
  ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;
ALTER TABLE "incident_attachments"
  ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;
ALTER TABLE "ca_photos"
  ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;
ALTER TABLE "equipment_inspection_record_attachments"
  ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "tenant_id", "record_id"
      ORDER BY "created_at", "id"
    ) - 1 AS "sort_order"
  FROM "inspection_record_attachments"
)
UPDATE "inspection_record_attachments" AS target
SET "sort_order" = ranked."sort_order"
FROM ranked
WHERE target."id" = ranked."id";

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "tenant_id", "assessment_id"
      ORDER BY "created_at", "id"
    ) - 1 AS "sort_order"
  FROM "hazid_assessment_photos"
)
UPDATE "hazid_assessment_photos" AS target
SET "sort_order" = ranked."sort_order"
FROM ranked
WHERE target."id" = ranked."id";

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "tenant_id", "incident_id"
      ORDER BY "created_at", "id"
    ) - 1 AS "sort_order"
  FROM "incident_attachments"
)
UPDATE "incident_attachments" AS target
SET "sort_order" = ranked."sort_order"
FROM ranked
WHERE target."id" = ranked."id";

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "tenant_id", "ca_id"
      ORDER BY "created_at", "id"
    ) - 1 AS "sort_order"
  FROM "ca_photos"
)
UPDATE "ca_photos" AS target
SET "sort_order" = ranked."sort_order"
FROM ranked
WHERE target."id" = ranked."id";

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "tenant_id", "record_id"
      ORDER BY "created_at", "id"
    ) - 1 AS "sort_order"
  FROM "equipment_inspection_record_attachments"
)
UPDATE "equipment_inspection_record_attachments" AS target
SET "sort_order" = ranked."sort_order"
FROM ranked
WHERE target."id" = ranked."id";

CREATE INDEX IF NOT EXISTS "inspection_record_attachments_record_order_idx"
  ON "inspection_record_attachments" ("tenant_id", "record_id", "sort_order");
CREATE INDEX IF NOT EXISTS "hazid_assessment_photos_assessment_order_idx"
  ON "hazid_assessment_photos" ("tenant_id", "assessment_id", "sort_order");
CREATE INDEX IF NOT EXISTS "incident_attachments_incident_order_idx"
  ON "incident_attachments" ("tenant_id", "incident_id", "sort_order");
CREATE INDEX IF NOT EXISTS "ca_photos_ca_order_idx"
  ON "ca_photos" ("tenant_id", "ca_id", "sort_order");
CREATE INDEX IF NOT EXISTS "equipment_inspection_record_attachments_record_order_idx"
  ON "equipment_inspection_record_attachments" ("tenant_id", "record_id", "sort_order");
