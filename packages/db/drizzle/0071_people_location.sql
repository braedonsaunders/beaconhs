-- People get one optional home location (an org unit: customer, site, or
-- project). It replaces the never-written people_assignments table, whose only
-- reader was the compliance "location" audience — that audience now resolves
-- through people.location_org_unit_id.
ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "location_org_unit_id" uuid;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_tenant_location_fk') THEN
    ALTER TABLE "people"
      ADD CONSTRAINT "people_tenant_location_fk"
      FOREIGN KEY ("tenant_id", "location_org_unit_id")
      REFERENCES "org_units" ("tenant_id", "id");
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_location_idx" ON "people" ("tenant_id", "location_org_unit_id");--> statement-breakpoint
DO $$
DECLARE
  tenant record;
  remaining integer;
BEGIN
  IF to_regclass('public.people_assignments') IS NULL THEN
    RETURN;
  END IF;
  -- FORCE RLS hides every row without a tenant context, so check per tenant.
  FOR tenant IN SELECT "id" FROM "tenants" LOOP
    PERFORM set_config('app.tenant_id', tenant."id"::text, true);
    EXECUTE 'SELECT count(*) FROM "people_assignments"' INTO remaining;
    IF remaining > 0 THEN
      RAISE EXCEPTION 'people_assignments has % rows for tenant %; move them to people.location_org_unit_id first',
        remaining, tenant."id";
    END IF;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;--> statement-breakpoint
DROP TABLE IF EXISTS "people_assignments";
