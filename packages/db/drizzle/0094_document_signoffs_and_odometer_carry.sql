-- Additive: historical starts remain explicit because their origin was not recorded.
ALTER TABLE truck_log_entries ADD COLUMN IF NOT EXISTS start_odometer_carried boolean NOT NULL DEFAULT false;
UPDATE roles SET permissions = permissions || '["documents.signoff"]'::jsonb, updated_at = now()
WHERE is_built_in AND key = 'foreman' AND NOT permissions @> '["documents.signoff"]'::jsonb;
