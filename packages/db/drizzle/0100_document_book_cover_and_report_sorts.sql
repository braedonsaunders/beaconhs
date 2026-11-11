-- 1. Seed the default Document Book Cover PDF template (`document-book-cover-pdf`)
--    for every tenant so book covers appear in `/admin/pdf-templates` and can be
--    edited or duplicated like any other module PDF template without overriding
--    any existing tenant-chosen default cover.
-- 2. Normalize stock `training_missing` report definitions whose `query->'sorts'`
--    still carried `[{"column":"expires_on","direction":"asc"}]` or single-column
--    `[{"column":"person_name","direction":"asc"}]` so grouped employee sections
--    sort alphabetically by employee and alphabetically by course inside each group.
DO $migration$
DECLARE
  tenant_id_val uuid;
  definition record;
  previous_tenant text := current_setting('app.tenant_id', true);
  cover_html text := '<div style="font-family:-apple-system,''Segoe UI'',Roboto,Arial,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 12%;color:#0f172a;">{{#if tenant_logo_url}}<div style="margin-bottom:56px;"><img src="{{tenant_logo_url}}" alt="" style="max-height:150px;max-width:70%;object-fit:contain;" /></div>{{/if}}<div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#64748b;">{{tenant_name}}</div><h1 style="margin:14px 0 0;font-size:40px;line-height:1.15;font-weight:700;color:#0f172a;">{{book_title}}</h1><div style="width:120px;height:3px;background:#0f172a;margin:26px auto;"></div>{{#if book_description}}<p style="margin:0;font-size:13px;line-height:1.6;color:#334155;max-width:80%;">{{book_description}}</p>{{/if}}{{#if issued_month_year}}<div style="margin-top:6px;font-size:12px;color:#64748b;">Issued {{issued_month_year}}</div>{{/if}}</div>';
  cover_merge_fields jsonb := '[
    {"key":"book_title","label":"Book title"},
    {"key":"book_description","label":"Book description"},
    {"key":"tenant_name","label":"Company name"},
    {"key":"tenant_logo_url","label":"Company logo URL"},
    {"key":"issued_month_year","label":"Issued month & year"},
    {"key":"published_at","label":"Published on"},
    {"key":"document_count","label":"Document count"},
    {"key":"chapter_count","label":"Chapter count"},
    {"key":"section_count","label":"Section count"}
  ]'::jsonb;
  next_sorts jsonb := '[{"column":"person_name","direction":"asc"},{"column":"course_name","direction":"asc"}]'::jsonb;
  next_query jsonb;
BEGIN
  FOR tenant_id_val IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant_id_val::text, true);

    INSERT INTO pdf_templates (
      tenant_id,
      key,
      name,
      record_subject_type,
      record_subject_key,
      paper_size,
      orientation,
      margin_mm,
      header_html,
      footer_html,
      compiled_html,
      source_html,
      merge_fields,
      is_active,
      is_module_default
    )
    VALUES (
      tenant_id_val,
      'document-book-cover-pdf',
      'Document Book Cover (PDF)',
      'module',
      'document-books',
      'letter',
      'portrait',
      0,
      '',
      '',
      cover_html,
      cover_html,
      cover_merge_fields,
      true,
      NOT EXISTS (
        SELECT 1
          FROM pdf_templates p2
         WHERE p2.tenant_id = tenant_id_val
           AND p2.record_subject_type = 'module'
           AND p2.record_subject_key = 'document-books'
           AND p2.is_module_default
           AND p2.deleted_at IS NULL
      )
    )
    ON CONFLICT (tenant_id, key) DO NOTHING;

    FOR definition IN
      SELECT id, "query"
        FROM report_definitions
       WHERE tenant_id = tenant_id_val
         AND (seed_key = 'training_missing' OR slug IN ('training-missing', 'training_missing'))
         AND "query"->>'entity' = 'training_matrix'
         AND "query"->>'groupBy' = 'person_name'
         AND coalesce("query"->'sorts', '[]'::jsonb) IN (
           '[{"column":"expires_on","direction":"asc"}]'::jsonb,
           '[{"column":"person_name","direction":"asc"}]'::jsonb,
           '[]'::jsonb
         )
    LOOP
      next_query := jsonb_set(jsonb_set(definition."query", '{sort}', 'null'::jsonb), '{sorts}', next_sorts);
      UPDATE report_definitions
         SET "query" = next_query,
             updated_at = now()
       WHERE id = definition.id
         AND tenant_id = tenant_id_val;
      INSERT INTO audit_log (tenant_id, entity_type, entity_id, action, summary, before, after, metadata)
        VALUES (
          tenant_id_val,
          'report_definition',
          definition.id,
          'update',
          'Normalize missing-training report default sort to employee then course',
          jsonb_build_object('query', definition."query"),
          jsonb_build_object('query', next_query),
          '{"migration":"0100_document_book_cover_and_report_sorts"}'::jsonb
        );
    END LOOP;
  END LOOP;

  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
END;
$migration$;
