-- Training classes: visible class days + credited hours, and the Site field
-- becomes an optional Customer.
--
-- 1. Rename site_org_unit_id -> customer_org_unit_id. The values already in
--    the column are customer-level org units (the customer the training was
--    delivered for); the free-text `location` column is where it was held.
-- 2. Backfill length_days (weekdays spanned, per-tenant timezone) and
--    hours_per_day (8 paid hours) where null, and bound both with checks.
-- 3. Turn on the generic "track the customer for each class" tenant setting
--    only for tenants that already record one (data-driven, no tenant names).
-- 4. Rewrite the retired flow variables in tenant templates/flows for the
--    training-classes subject: site_name -> location,
--    site_org_unit_id -> customer_org_unit_id.
--
-- Idempotent: every rename is guarded, backfills only touch nulls, the
-- setting is only written when unset, and the text rewrites no-op once done.

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'training_classes' AND column_name = 'site_org_unit_id'
  ) THEN
    ALTER TABLE training_classes RENAME COLUMN site_org_unit_id TO customer_org_unit_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'training_classes'::regclass
      AND conname = 'training_classes_tenant_site_fk'
  ) THEN
    ALTER TABLE training_classes
      RENAME CONSTRAINT training_classes_tenant_site_fk TO training_classes_tenant_customer_fk;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'training_classes_site_idx') THEN
    ALTER INDEX training_classes_site_idx RENAME TO training_classes_customer_idx;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'training_classes'::regclass
      AND conname = 'training_classes_length_days_check'
  ) THEN
    ALTER TABLE training_classes ADD CONSTRAINT training_classes_length_days_check
      CHECK (length_days IS NULL OR (length_days >= 1 AND length_days <= 366));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'training_classes'::regclass
      AND conname = 'training_classes_hours_per_day_check'
  ) THEN
    ALTER TABLE training_classes ADD CONSTRAINT training_classes_hours_per_day_check
      CHECK (
        hours_per_day IS NULL
        OR (
          hours_per_day >= 0.25
          AND hours_per_day <= 24
          AND hours_per_day * 4 = trunc(hours_per_day * 4)
        )
      );
  END IF;
END;
$migration$;
--> statement-breakpoint
DO $migration$
DECLARE
  tenant_row record;
  tenant_tz text;
BEGIN
  FOR tenant_row IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant_row.id::text, true);

    -- Tenants carry no timezone of their own; the working timezone is the one
    -- most of the tenant's users run in (the user default is America/Toronto).
    SELECT coalesce(
      (
        SELECT u.timezone
        FROM tenant_users tu
        JOIN "user" u ON u.id = tu.user_id
        WHERE tu.tenant_id = tenant_row.id
          AND EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = u.timezone)
        GROUP BY u.timezone
        ORDER BY count(*) DESC, u.timezone
        LIMIT 1
      ),
      'America/Toronto'
    ) INTO tenant_tz;

    UPDATE training_classes c
    SET
      length_days = coalesce(
        c.length_days,
        least(
          366,
          greatest(
            1,
            (
              SELECT count(*)::int
              FROM generate_series(
                (c.starts_at AT TIME ZONE tenant_tz)::date,
                (c.ends_at AT TIME ZONE tenant_tz)::date,
                interval '1 day'
              ) AS d
              WHERE extract(dow FROM d) BETWEEN 1 AND 5
            )
          )
        )
      ),
      hours_per_day = coalesce(c.hours_per_day, 8),
      updated_at = now()
    WHERE c.tenant_id = tenant_row.id
      AND (c.length_days IS NULL OR c.hours_per_day IS NULL);

    -- Flow variable cutover for this tenant's class templates and flows.
    UPDATE email_templates
    SET
      subject_template = replace(
        replace(subject_template, 'site_org_unit_id', 'customer_org_unit_id'),
        'site_name',
        'location'
      ),
      source_html = CASE
        WHEN source_html IS NULL THEN NULL
        ELSE replace(
          replace(source_html, 'site_org_unit_id', 'customer_org_unit_id'),
          'site_name',
          'location'
        )
      END,
      compiled_html = replace(
        replace(compiled_html, 'site_org_unit_id', 'customer_org_unit_id'),
        'site_name',
        'location'
      ),
      merge_fields = replace(
        replace(merge_fields::text, 'site_org_unit_id', 'customer_org_unit_id'),
        'site_name',
        'location'
      )::jsonb,
      updated_at = now()
    WHERE tenant_id = tenant_row.id
      AND record_subject_type = 'module'
      AND record_subject_key = 'training-classes'
      AND (
        subject_template LIKE '%site_name%'
        OR subject_template LIKE '%site_org_unit_id%'
        OR source_html LIKE '%site_name%'
        OR source_html LIKE '%site_org_unit_id%'
        OR compiled_html LIKE '%site_name%'
        OR compiled_html LIKE '%site_org_unit_id%'
        OR merge_fields::text LIKE '%site_name%'
        OR merge_fields::text LIKE '%site_org_unit_id%'
      );

    UPDATE pdf_templates
    SET
      header_html = CASE
        WHEN header_html IS NULL THEN NULL
        ELSE replace(
          replace(header_html, 'site_org_unit_id', 'customer_org_unit_id'),
          'site_name',
          'location'
        )
      END,
      footer_html = CASE
        WHEN footer_html IS NULL THEN NULL
        ELSE replace(
          replace(footer_html, 'site_org_unit_id', 'customer_org_unit_id'),
          'site_name',
          'location'
        )
      END,
      source_html = CASE
        WHEN source_html IS NULL THEN NULL
        ELSE replace(
          replace(source_html, 'site_org_unit_id', 'customer_org_unit_id'),
          'site_name',
          'location'
        )
      END,
      compiled_html = replace(
        replace(compiled_html, 'site_org_unit_id', 'customer_org_unit_id'),
        'site_name',
        'location'
      ),
      merge_fields = replace(
        replace(merge_fields::text, 'site_org_unit_id', 'customer_org_unit_id'),
        'site_name',
        'location'
      )::jsonb,
      updated_at = now()
    WHERE tenant_id = tenant_row.id
      AND record_subject_type = 'module'
      AND record_subject_key = 'training-classes'
      AND (
        header_html LIKE '%site_name%'
        OR header_html LIKE '%site_org_unit_id%'
        OR footer_html LIKE '%site_name%'
        OR footer_html LIKE '%site_org_unit_id%'
        OR source_html LIKE '%site_name%'
        OR source_html LIKE '%site_org_unit_id%'
        OR compiled_html LIKE '%site_name%'
        OR compiled_html LIKE '%site_org_unit_id%'
        OR merge_fields::text LIKE '%site_name%'
        OR merge_fields::text LIKE '%site_org_unit_id%'
      );

    UPDATE form_automations
    SET
      graph = replace(
        replace(graph::text, 'site_org_unit_id', 'customer_org_unit_id'),
        'site_name',
        'location'
      )::jsonb,
      updated_at = now()
    WHERE tenant_id = tenant_row.id
      AND subject_type = 'module'
      AND subject_key = 'training-classes'
      AND (graph::text LIKE '%site_name%' OR graph::text LIKE '%site_org_unit_id%');
  END LOOP;

  PERFORM set_config('app.tenant_id', '', true);
END;
$migration$;
--> statement-breakpoint
-- Enable customer tracking only where classes already record a customer.
-- training_classes is FORCE-RLS, so probe per tenant inside the loop above's
-- pattern rather than with one cross-tenant EXISTS that would see no rows.
DO $migration$
DECLARE
  tenant_row record;
  has_customer boolean;
BEGIN
  FOR tenant_row IN SELECT id, settings FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant_row.id::text, true);
    SELECT EXISTS (
      SELECT 1 FROM training_classes
      WHERE tenant_id = tenant_row.id AND customer_org_unit_id IS NOT NULL
    ) INTO has_customer;

    IF has_customer AND tenant_row.settings -> 'training' -> 'trackClassCustomer' IS NULL THEN
      UPDATE tenants
      SET settings = jsonb_set(
        coalesce(settings, '{}'::jsonb),
        '{training}',
        coalesce(settings -> 'training', '{}'::jsonb) || '{"trackClassCustomer": true}'::jsonb,
        true
      )
      WHERE id = tenant_row.id;
    END IF;
  END LOOP;

  PERFORM set_config('app.tenant_id', '', true);
END;
$migration$;
