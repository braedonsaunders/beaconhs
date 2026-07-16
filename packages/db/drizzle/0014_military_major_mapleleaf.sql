CREATE TEMP TABLE notification_group_cutover (
  tenant_id uuid NOT NULL,
  old_id uuid PRIMARY KEY,
  new_id uuid NOT NULL
) ON COMMIT DROP;--> statement-breakpoint

INSERT INTO notification_group_cutover (tenant_id, old_id, new_id)
SELECT ng.tenant_id,
       ng.id,
       COALESCE(existing.id, ng.id)
  FROM notification_groups ng
  LEFT JOIN LATERAL (
    SELECT pg.id
      FROM person_groups pg
     WHERE pg.tenant_id = ng.tenant_id
       AND lower(btrim(pg.name)) = lower(btrim(ng.name))
     ORDER BY pg.created_at, pg.id
     LIMIT 1
  ) existing ON true;--> statement-breakpoint

INSERT INTO person_groups (
  id, tenant_id, name, description, color, created_at, updated_at, deleted_at
)
SELECT ng.id,
       ng.tenant_id,
       ng.name,
       ng.description,
       ng.color,
       ng.created_at,
       ng.updated_at,
       ng.deleted_at
  FROM notification_groups ng
  JOIN notification_group_cutover map ON map.old_id = ng.id AND map.new_id = ng.id
ON CONFLICT DO NOTHING;--> statement-breakpoint

WITH expanded AS (
  SELECT ngm.group_id, ngm.tenant_id, ngm.mode, p.id AS person_id
    FROM notification_group_members ngm
    JOIN people p ON p.tenant_id = ngm.tenant_id
   WHERE ngm.kind = 'everyone'
     AND p.status = 'active'
     AND p.deleted_at IS NULL
  UNION ALL
  SELECT ngm.group_id, ngm.tenant_id, ngm.mode, p.id
    FROM notification_group_members ngm
    JOIN people p ON p.tenant_id = ngm.tenant_id AND p.id::text = ngm.entity_key
   WHERE ngm.kind = 'person' AND p.status = 'active' AND p.deleted_at IS NULL
  UNION ALL
  SELECT ngm.group_id, ngm.tenant_id, ngm.mode, p.id
    FROM notification_group_members ngm
    JOIN people p ON p.tenant_id = ngm.tenant_id AND p.department_id::text = ngm.entity_key
   WHERE ngm.kind = 'department' AND p.status = 'active' AND p.deleted_at IS NULL
  UNION ALL
  SELECT ngm.group_id, ngm.tenant_id, ngm.mode, p.id
    FROM notification_group_members ngm
    JOIN people p ON p.tenant_id = ngm.tenant_id AND p.trade_id::text = ngm.entity_key
   WHERE ngm.kind = 'trade' AND p.status = 'active' AND p.deleted_at IS NULL
  UNION ALL
  SELECT ngm.group_id, ngm.tenant_id, ngm.mode, p.id
    FROM notification_group_members ngm
    JOIN people p ON p.tenant_id = ngm.tenant_id AND p.crew_id::text = ngm.entity_key
   WHERE ngm.kind = 'crew' AND p.status = 'active' AND p.deleted_at IS NULL
  UNION ALL
  SELECT ngm.group_id, ngm.tenant_id, ngm.mode, p.id
    FROM notification_group_members ngm
    JOIN person_group_memberships pgm
      ON pgm.tenant_id = ngm.tenant_id AND pgm.group_id::text = ngm.entity_key
    JOIN people p ON p.tenant_id = pgm.tenant_id AND p.id = pgm.person_id
   WHERE ngm.kind = 'person_group' AND p.status = 'active' AND p.deleted_at IS NULL
  UNION ALL
  SELECT ngm.group_id, ngm.tenant_id, ngm.mode, p.id
    FROM notification_group_members ngm
    JOIN people_assignments pa
      ON pa.tenant_id = ngm.tenant_id AND pa.org_unit_id::text = ngm.entity_key
     AND pa.valid_from <= current_date AND (pa.valid_to IS NULL OR pa.valid_to >= current_date)
    JOIN people p ON p.tenant_id = pa.tenant_id AND p.id = pa.person_id
   WHERE ngm.kind = 'org_unit' AND p.status = 'active' AND p.deleted_at IS NULL
  UNION ALL
  SELECT ngm.group_id, ngm.tenant_id, ngm.mode, p.id
    FROM notification_group_members ngm
    JOIN roles r ON r.tenant_id = ngm.tenant_id AND r.key = ngm.entity_key
    JOIN role_assignments ra ON ra.tenant_id = r.tenant_id AND ra.role_id = r.id
    JOIN tenant_users tu
      ON tu.tenant_id = ra.tenant_id AND tu.id = ra.tenant_user_id AND tu.status = 'active'
    JOIN people p
      ON p.tenant_id = tu.tenant_id AND p.user_id = tu.user_id
     AND p.status = 'active' AND p.deleted_at IS NULL
   WHERE ngm.kind = 'role'
), desired AS (
  SELECT DISTINCT included.tenant_id, included.group_id, included.person_id
    FROM expanded included
   WHERE included.mode = 'include'
     AND NOT EXISTS (
       SELECT 1
         FROM expanded excluded
        WHERE excluded.tenant_id = included.tenant_id
          AND excluded.group_id = included.group_id
          AND excluded.person_id = included.person_id
          AND excluded.mode = 'exclude'
     )
)
INSERT INTO person_group_memberships (tenant_id, group_id, person_id)
SELECT desired.tenant_id, map.new_id, desired.person_id
  FROM desired
  JOIN notification_group_cutover map
    ON map.tenant_id = desired.tenant_id AND map.old_id = desired.group_id
ON CONFLICT DO NOTHING;--> statement-breakpoint

UPDATE tenant_notification_settings settings
   SET group_ids = (
     SELECT COALESCE(jsonb_agg(to_jsonb(COALESCE(map.new_id::text, item.value))), '[]'::jsonb)
       FROM jsonb_array_elements_text(settings.group_ids) item(value)
       LEFT JOIN notification_group_cutover map
         ON map.tenant_id = settings.tenant_id AND map.old_id::text = item.value
   )
 WHERE jsonb_array_length(settings.group_ids) > 0;--> statement-breakpoint

DO $$
DECLARE mapping record;
BEGIN
  FOR mapping IN SELECT old_id, new_id FROM notification_group_cutover WHERE old_id <> new_id LOOP
    UPDATE form_automations
       SET graph = replace(graph::text, mapping.old_id::text, mapping.new_id::text)::jsonb
     WHERE graph::text LIKE '%' || mapping.old_id::text || '%';
  END LOOP;
  UPDATE form_automations
     SET graph = replace(graph::text, '"type": "group"', '"type": "person_group"')::jsonb
   WHERE graph::text LIKE '%"type": "group"%';
END $$;--> statement-breakpoint

UPDATE people p
   SET group_ids = COALESCE(
     (
       SELECT jsonb_agg(pgm.group_id::text ORDER BY pgm.group_id::text)
         FROM person_group_memberships pgm
        WHERE pgm.tenant_id = p.tenant_id AND pgm.person_id = p.id
     ),
     '[]'::jsonb
   );--> statement-breakpoint

DROP TABLE "notification_group_members" CASCADE;--> statement-breakpoint
DROP TABLE "notification_groups" CASCADE;--> statement-breakpoint
DROP TYPE "public"."notification_group_member_kind";--> statement-breakpoint
DROP TYPE "public"."notification_group_member_mode";
