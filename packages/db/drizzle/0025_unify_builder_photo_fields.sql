-- Clean-cutover Builder photo fields to one schema type and one response value.
-- Legacy numbered markers are retained as visible text annotations on the first
-- photo. The helper functions are transaction-local migration machinery and are
-- dropped at the end.

CREATE FUNCTION beaconhs_migrate_builder_photo_value(raw_value jsonb, legacy_type text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  migrated jsonb;
  photo_rows jsonb;
  marker_annotations jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(raw_value) = 'array' THEN
    photo_rows := raw_value;
  ELSIF jsonb_typeof(raw_value) = 'object'
    AND jsonb_typeof(raw_value->'attachments') = 'array' THEN
    photo_rows := raw_value->'attachments';
  ELSE
    photo_rows := '[]'::jsonb;
  END IF;

  IF legacy_type = 'photo_annotated'
    AND jsonb_typeof(raw_value->'markers') = 'array' THEN
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'type', 'text',
          'x', least(
            1000,
            greatest(
              0,
              CASE
                WHEN jsonb_typeof(marker->'x') = 'number' THEN (marker->>'x')::numeric * 1000
                ELSE 0
              END
            )
          ),
          'y', least(
            1000,
            greatest(
              0,
              CASE
                WHEN jsonb_typeof(marker->'y') = 'number' THEN (marker->>'y')::numeric * 1000
                ELSE 0
              END
            )
          ),
          'text', concat(
            marker_number,
            CASE
              WHEN nullif(btrim(marker->>'label'), '') IS NULL THEN ''
              ELSE concat('. ', left(marker->>'label', 495))
            END
          ),
          'color', '#e11d48',
          'size', 40
        )
        ORDER BY marker_number
      ),
      '[]'::jsonb
    )
    INTO marker_annotations
    FROM jsonb_array_elements(raw_value->'markers')
      WITH ORDINALITY AS markers(marker, marker_number)
    WHERE jsonb_typeof(marker) = 'object';
  END IF;

  IF jsonb_array_length(photo_rows) > 0 AND jsonb_array_length(marker_annotations) > 0 THEN
    SELECT jsonb_agg(
      CASE
        WHEN photo_number = 1 THEN
          photo || jsonb_build_object(
            'annotations',
            CASE
              WHEN jsonb_typeof(photo->'annotations') = 'array'
                THEN photo->'annotations' || marker_annotations
              ELSE marker_annotations
            END
          )
        ELSE photo
      END
      ORDER BY photo_number
    )
    INTO photo_rows
    FROM jsonb_array_elements(photo_rows)
      WITH ORDINALITY AS photos(photo, photo_number);
  END IF;

  migrated := jsonb_build_object('attachments', photo_rows);
  IF jsonb_typeof(raw_value) = 'object'
    AND raw_value ? 'analysis'
    AND raw_value ? 'analyzedAt' THEN
    migrated := migrated
      || jsonb_build_object(
        'analysis', raw_value->'analysis',
        'analyzedAt', raw_value->'analyzedAt'
      );
  END IF;
  RETURN migrated;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION beaconhs_migrate_builder_photo_data(form_schema jsonb, response_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  migrated jsonb := coalesce(response_data, '{}'::jsonb);
  section_value jsonb;
  field_value jsonb;
  row_value jsonb;
  migrated_rows jsonb;
  migrated_row jsonb;
  section_id text;
  field_id text;
  legacy_type text;
BEGIN
  IF jsonb_typeof(form_schema->'sections') <> 'array' THEN
    RETURN migrated;
  END IF;

  FOR section_value IN SELECT value FROM jsonb_array_elements(form_schema->'sections')
  LOOP
    section_id := section_value->>'id';
    IF coalesce((section_value->>'repeating')::boolean, false) THEN
      IF jsonb_typeof(migrated->section_id) <> 'array' THEN
        CONTINUE;
      END IF;
      migrated_rows := '[]'::jsonb;
      FOR row_value IN SELECT value FROM jsonb_array_elements(migrated->section_id)
      LOOP
        migrated_row := row_value;
        IF jsonb_typeof(migrated_row) = 'object' THEN
          FOR field_value IN SELECT value FROM jsonb_array_elements(section_value->'fields')
          LOOP
            field_id := field_value->>'id';
            legacy_type := field_value->>'type';
            IF legacy_type IN ('photo', 'photo_upload', 'photo_ai', 'photo_annotated')
              AND migrated_row ? field_id THEN
              migrated_row := jsonb_set(
                migrated_row,
                ARRAY[field_id],
                beaconhs_migrate_builder_photo_value(migrated_row->field_id, legacy_type),
                true
              );
            END IF;
          END LOOP;
        END IF;
        migrated_rows := migrated_rows || jsonb_build_array(migrated_row);
      END LOOP;
      migrated := jsonb_set(migrated, ARRAY[section_id], migrated_rows, true);
    ELSE
      FOR field_value IN SELECT value FROM jsonb_array_elements(section_value->'fields')
      LOOP
        field_id := field_value->>'id';
        legacy_type := field_value->>'type';
        IF legacy_type IN ('photo', 'photo_upload', 'photo_ai', 'photo_annotated')
          AND migrated ? field_id THEN
          migrated := jsonb_set(
            migrated,
            ARRAY[field_id],
            beaconhs_migrate_builder_photo_value(migrated->field_id, legacy_type),
            true
          );
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN migrated;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION beaconhs_migrate_builder_photo_draft(form_schema jsonb, draft_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  combined jsonb;
  migrated jsonb;
  migrated_values jsonb;
  migrated_rows jsonb := '{}'::jsonb;
  section_value jsonb;
  section_id text;
BEGIN
  IF draft_data IS NULL OR jsonb_typeof(draft_data) <> 'object' THEN
    RETURN draft_data;
  END IF;
  combined := coalesce(draft_data->'values', '{}'::jsonb)
    || coalesce(draft_data->'rows', '{}'::jsonb);
  migrated := beaconhs_migrate_builder_photo_data(form_schema, combined);
  migrated_values := migrated;

  FOR section_value IN SELECT value FROM jsonb_array_elements(form_schema->'sections')
  LOOP
    IF coalesce((section_value->>'repeating')::boolean, false) THEN
      section_id := section_value->>'id';
      IF migrated ? section_id THEN
        migrated_rows := jsonb_set(
          migrated_rows,
          ARRAY[section_id],
          migrated->section_id,
          true
        );
        migrated_values := migrated_values - section_id;
      END IF;
    END IF;
  END LOOP;

  RETURN draft_data || jsonb_build_object('values', migrated_values, 'rows', migrated_rows);
END;
$$;
--> statement-breakpoint

UPDATE form_responses AS response
SET
  data = beaconhs_migrate_builder_photo_data(version.schema, response.data),
  draft_data = beaconhs_migrate_builder_photo_draft(version.schema, response.draft_data)
FROM form_template_versions AS version
WHERE version.id = response.template_version_id
  AND version.tenant_id = response.tenant_id
  AND version.schema::text ~ '"type"[[:space:]]*:[[:space:]]*"photo(_upload|_ai|_annotated)?"';
--> statement-breakpoint

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT DISTINCT
      template.id AS pdf_template_id,
      field->>'id' AS field_id,
      coalesce((section->>'repeating')::boolean, false) AS repeating
    FROM pdf_templates AS template
    JOIN form_template_versions AS version
      ON version.tenant_id = template.tenant_id
      AND version.template_id::text = template.record_subject_key
    CROSS JOIN LATERAL jsonb_array_elements(version.schema->'sections') AS sections(section)
    CROSS JOIN LATERAL jsonb_array_elements(section->'fields') AS fields(field)
    WHERE template.record_subject_type = 'form_template'
      AND field->>'type' IN ('photo', 'photo_upload')
  LOOP
    IF target.repeating THEN
      UPDATE pdf_templates
      SET
        source_html = replace(
          source_html,
          concat('{{', target.field_id, '}}'),
          concat('{{', target.field_id, '_text}}')
        ),
        compiled_html = replace(
          compiled_html,
          concat('{{', target.field_id, '}}'),
          concat('{{', target.field_id, '_text}}')
        )
      WHERE id = target.pdf_template_id;
    ELSE
      UPDATE pdf_templates
      SET
        source_html = replace(
          replace(
            source_html,
            concat('data-each="', target.field_id, '"'),
            concat('data-each="', target.field_id, '_photos"')
          ),
          concat('data-if="', target.field_id, '"'),
          concat('data-if="', target.field_id, '_photos"')
        ),
        compiled_html = replace(
          replace(
            compiled_html,
            concat('{{#each ', target.field_id, '}}'),
            concat('{{#each ', target.field_id, '_photos}}')
          ),
          concat('{{#if ', target.field_id, '}}'),
          concat('{{#if ', target.field_id, '_photos}}')
        )
      WHERE id = target.pdf_template_id;
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint

CREATE FUNCTION beaconhs_migrate_builder_photo_schema(form_schema jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  migrated_sections jsonb := '[]'::jsonb;
  migrated_fields jsonb;
  section_value jsonb;
  field_value jsonb;
  config_value jsonb;
  legacy_type text;
BEGIN
  IF jsonb_typeof(form_schema->'sections') <> 'array' THEN
    RETURN form_schema;
  END IF;

  FOR section_value IN SELECT value FROM jsonb_array_elements(form_schema->'sections')
  LOOP
    migrated_fields := '[]'::jsonb;
    FOR field_value IN SELECT value FROM jsonb_array_elements(section_value->'fields')
    LOOP
      legacy_type := field_value->>'type';
      IF legacy_type IN ('photo', 'photo_upload', 'photo_ai', 'photo_annotated') THEN
        -- The retired standard and AI uploaders always allowed up to the
        -- validator-wide limit, regardless of ad hoc config JSON. Preserve
        -- every historically valid response; only the annotated variant had a
        -- real single-photo constraint.
        config_value := jsonb_build_object('multiple', true, 'maxFiles', 50);
        IF legacy_type = 'photo_ai' THEN
          config_value := config_value || jsonb_build_object('aiAnalysis', true);
        ELSIF legacy_type = 'photo_annotated' THEN
          config_value := config_value
            || jsonb_build_object('multiple', false, 'maxFiles', 1);
        END IF;
        field_value := jsonb_set(field_value, '{type}', '"photo"'::jsonb, true);
        field_value := jsonb_set(field_value, '{config}', config_value, true);
      END IF;
      migrated_fields := migrated_fields || jsonb_build_array(field_value);
    END LOOP;
    migrated_sections := migrated_sections
      || jsonb_build_array(jsonb_set(section_value, '{fields}', migrated_fields, true));
  END LOOP;

  RETURN jsonb_set(form_schema, '{sections}', migrated_sections, true);
END;
$$;
--> statement-breakpoint

UPDATE form_template_versions
SET schema = beaconhs_migrate_builder_photo_schema(schema)
WHERE schema::text ~ '"type"[[:space:]]*:[[:space:]]*"photo(_upload|_ai|_annotated)?"';
--> statement-breakpoint

DROP FUNCTION beaconhs_migrate_builder_photo_draft(jsonb, jsonb);
--> statement-breakpoint
DROP FUNCTION beaconhs_migrate_builder_photo_data(jsonb, jsonb);
--> statement-breakpoint
DROP FUNCTION beaconhs_migrate_builder_photo_value(jsonb, text);
--> statement-breakpoint
DROP FUNCTION beaconhs_migrate_builder_photo_schema(jsonb);
