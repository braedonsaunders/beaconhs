-- Language policy is tenant-owned. Preserve each membership's effective
-- supported language while moving the retired global user preference to the
-- tenant membership, then enforce the canonical tenant policy. FORCE RLS would
-- hide tenant data from the NOLOGIN migration owner, so it is relaxed only for
-- the bounded normalization and restored before constraints are installed.
ALTER TABLE "tenant_users" ADD COLUMN "locale_override" text;--> statement-breakpoint
ALTER TABLE "tenant_users" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenants" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

UPDATE "tenants"
SET "default_language" = 'en'
WHERE "default_language" NOT IN ('en', 'fr', 'es');--> statement-breakpoint

UPDATE "tenants" AS tenant
SET "enabled_languages" = COALESCE(
  (
    SELECT jsonb_agg(language ORDER BY language)
    FROM (
      SELECT DISTINCT value AS language
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(tenant."enabled_languages") = 'array'
            THEN tenant."enabled_languages"
          ELSE '[]'::jsonb
        END
      )
      WHERE value IN ('en', 'fr', 'es')
    ) AS supported
  ),
  '[]'::jsonb
);--> statement-breakpoint

UPDATE "tenants"
SET "enabled_languages" = "enabled_languages" || jsonb_build_array("default_language")
WHERE NOT "enabled_languages" ? "default_language";--> statement-breakpoint

UPDATE "tenant_users" AS membership
SET "locale_override" = identity."locale"
FROM "user" AS identity, "tenants" AS tenant
WHERE membership."user_id" = identity."id"
  AND membership."tenant_id" = tenant."id"
  AND identity."locale" IN ('en', 'fr', 'es')
  AND tenant."enabled_languages" ? identity."locale"
  AND identity."locale" <> tenant."default_language";--> statement-breakpoint

ALTER TABLE "user" DROP COLUMN "locale";--> statement-breakpoint
ALTER TABLE "tenant_users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "tenant_users"
  ADD CONSTRAINT "tenant_users_locale_override_supported_check"
  CHECK (
    "tenant_users"."locale_override" IS NULL
    OR "tenant_users"."locale_override" IN ('en', 'fr', 'es')
  ) NOT VALID;--> statement-breakpoint
ALTER TABLE "tenant_users"
  VALIDATE CONSTRAINT "tenant_users_locale_override_supported_check";--> statement-breakpoint
ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_default_language_supported_check"
  CHECK ("tenants"."default_language" IN ('en', 'fr', 'es')) NOT VALID;--> statement-breakpoint
ALTER TABLE "tenants"
  VALIDATE CONSTRAINT "tenants_default_language_supported_check";--> statement-breakpoint
ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_enabled_languages_valid_check"
  CHECK (
    jsonb_typeof("tenants"."enabled_languages") = 'array'
    AND "tenants"."enabled_languages" <@ '["en", "fr", "es"]'::jsonb
    AND "tenants"."enabled_languages" ? "tenants"."default_language"
  ) NOT VALID;--> statement-breakpoint
ALTER TABLE "tenants"
  VALIDATE CONSTRAINT "tenants_enabled_languages_valid_check";
