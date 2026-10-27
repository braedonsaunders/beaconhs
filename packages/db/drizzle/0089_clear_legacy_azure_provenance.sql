-- Clear legacy-import provenance that was stored in user-facing text fields.
--
-- The old Beacon kept files in Azure Blob (beaconhs.blob.core.windows.net)
-- and the importer wrote the source URL into attachments.caption (not a user
-- caption) and into one training_skill_assignments.notes. Those URLs are not
-- content anyone typed, and they break once the old account is retired.
-- Captions that ARE just the URL are cleared outright; a skill-assignment
-- note that is just the link is cleared the same way.
DO $migration$
DECLARE
  tenant_row record;
BEGIN
  FOR tenant_row IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant_row.id::text, true);
    UPDATE attachments
    SET caption = NULL, updated_at = now()
    WHERE tenant_id = tenant_row.id
      AND caption LIKE 'https://%.blob.core.windows.net/%';
    -- The one affected note reads "Complete · <azure url>": strip just the
    -- link (and its separator), keeping any words a person actually wrote.
    UPDATE training_skill_assignments
    SET notes = NULLIF(
          BTRIM(regexp_replace(notes, '\s*·?\s*https://[A-Za-z0-9.-]+\.blob\.core\.windows\.net/\S+', '', 'g')),
          ''
        ),
        updated_at = now()
    WHERE tenant_id = tenant_row.id
      AND notes LIKE '%blob.core.windows.net%';
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END;
$migration$;
