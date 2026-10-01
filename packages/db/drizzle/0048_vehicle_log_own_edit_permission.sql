-- Supervisors may maintain their own driving log without administering equipment.
-- Preserve all existing permissions and explicit user-level denials.
UPDATE "roles"
SET "permissions" = "permissions" || '["equipment.vehicle-log.update.own"]'::jsonb,
    "updated_at" = now()
WHERE "is_built_in" = true AND "key" = 'foreman'
  AND NOT ("permissions" ? 'equipment.vehicle-log.update.own');
