-- Generated narrative rows must flow across sheets instead of moving the
-- entire entry/description to the next page. Preserve tenant text, bindings,
-- formatting and template assignments; change only the generated row's
-- keep-together hint in both the editable source and the compiled document.
-- Each tenant context is required because the owner is subject to FORCE RLS.
DO $$
DECLARE
  tenant record;
  pattern text := '(<tr[^>]*style=")page-break-inside:avoid;("><td style="border:none;padding:12px 0 0;">)<div style="([^"]*)">';
BEGIN
  FOR tenant IN SELECT "id" FROM "tenants" LOOP
    PERFORM set_config('app.tenant_id', tenant."id"::text, true);
    UPDATE "pdf_templates"
    SET "source_html" = regexp_replace("source_html", pattern, '\1page-break-inside:auto;\2<div style="\3break-after:avoid;page-break-after:avoid;">', 'g'),
        "compiled_html" = regexp_replace("compiled_html", pattern, '\1page-break-inside:auto;\2<div style="\3break-after:avoid;page-break-after:avoid;">', 'g'),
        "updated_at" = now()
    WHERE "tenant_id" = tenant."id"
      AND ("source_html" ~ pattern OR "compiled_html" ~ pattern);
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
