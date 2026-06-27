ALTER TABLE "tenant_nav_config" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

UPDATE "tenant_nav_config" AS t
SET
  "config" = jsonb_set(
    t."config",
    '{groups}',
    (
      SELECT COALESCE(
        jsonb_agg(
          CASE
            WHEN cleaned_group.group_obj->>'id' = 'platform'
              OR cleaned_group.group_obj->>'label' = 'Platform'
            THEN jsonb_set(
              jsonb_set(cleaned_group.group_obj, '{id}', '"administration"'::jsonb, false),
              '{label}',
              '"Administration"'::jsonb,
              false
            )
            ELSE cleaned_group.group_obj
          END
          ORDER BY cleaned_group.group_ord
        ),
        '[]'::jsonb
      )
      FROM (
        SELECT
          source_group.group_ord,
          jsonb_set(
            source_group.group_obj,
            '{items}',
            (
              SELECT COALESCE(jsonb_agg(item_obj ORDER BY item_ord), '[]'::jsonb)
              FROM jsonb_array_elements(COALESCE(source_group.group_obj->'items', '[]'::jsonb))
                WITH ORDINALITY AS source_item(item_obj, item_ord)
              WHERE NOT (
                source_item.item_obj->>'kind' = 'module'
                AND source_item.item_obj->>'moduleKey' = 'utilities'
              )
            ),
            false
          ) AS group_obj
        FROM jsonb_array_elements(t."config"->'groups')
          WITH ORDINALITY AS source_group(group_obj, group_ord)
      ) AS cleaned_group
      WHERE jsonb_array_length(COALESCE(cleaned_group.group_obj->'items', '[]'::jsonb)) > 0
    ),
    false
  ),
  "updated_at" = now()
WHERE t."config"::text LIKE '%Platform%'
  OR t."config"::text LIKE '%utilities%';--> statement-breakpoint

ALTER TABLE "tenant_nav_config" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

UPDATE "roles" AS r
SET
  "permissions" = (
    SELECT COALESCE(jsonb_agg(normalized.permission ORDER BY normalized.permission), '[]'::jsonb)
    FROM (
      SELECT DISTINCT
        CASE
          WHEN permission_value.value = 'utilities.export' THEN 'admin.data.export'
          ELSE permission_value.value
        END AS permission
      FROM jsonb_array_elements_text(r."permissions") AS permission_value(value)
      WHERE permission_value.value <> 'utilities.view'
    ) AS normalized
  ),
  "updated_at" = now()
WHERE r."permissions" ? 'utilities.export'
  OR r."permissions" ? 'utilities.view';--> statement-breakpoint

ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
