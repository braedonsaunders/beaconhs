UPDATE roles SET permissions = (
  SELECT jsonb_agg(DISTINCT permission)
  FROM jsonb_array_elements(permissions || '["inspections.delete.own", "hazid.delete.own", "incidents.delete.own"]'::jsonb) AS permission
), updated_at = now()
WHERE is_built_in AND key IN ('worker', 'foreman');
