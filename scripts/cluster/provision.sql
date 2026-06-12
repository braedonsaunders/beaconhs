-- BeaconHS database provisioning (run once as a Postgres superuser).
--
-- Usage:
--   psql "postgres://postgres:***@localhost:5432/postgres" \
--        -v app_password="'CHANGE_ME_STRONG'" -f scripts/cluster/provision.sql
--
-- Creates a least-privilege application role + the `beaconhs` database. The app schema itself
-- (tables, RLS) is created afterwards by `pnpm --filter @beaconhs/db migrate`, and the `etl`
-- bookkeeping schema by `pnpm --filter @beaconhs/etl etl bootstrap`.

\set ON_ERROR_STOP on

-- 1) Least-privilege application login role (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'beaconhs_app') THEN
    EXECUTE format('CREATE ROLE beaconhs_app LOGIN PASSWORD %L', :'app_password');
  END IF;
END $$;

-- 2) Application database, owned by the app role. (CREATE DATABASE cannot run in a DO block /
--    transaction, so it is guarded with \gexec.) Inherits the cluster's default UTF8 encoding.
SELECT 'CREATE DATABASE beaconhs OWNER beaconhs_app'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'beaconhs')
\gexec

-- 3) Database-level defaults + extensions (connect into the new DB).
\connect beaconhs
ALTER DATABASE beaconhs SET timezone TO 'UTC';
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- trigram search (journals/forms FTS helpers)

-- 4) Make the app role the owner of public + a dedicated etl schema for the migration crosswalk.
ALTER SCHEMA public OWNER TO beaconhs_app;
GRANT ALL ON SCHEMA public TO beaconhs_app;
CREATE SCHEMA IF NOT EXISTS etl AUTHORIZATION beaconhs_app;

-- 5) Sensible default privileges so future app-created objects stay owned correctly.
ALTER DEFAULT PRIVILEGES FOR ROLE beaconhs_app IN SCHEMA public  GRANT ALL ON TABLES TO beaconhs_app;
ALTER DEFAULT PRIVILEGES FOR ROLE beaconhs_app IN SCHEMA etl     GRANT ALL ON TABLES TO beaconhs_app;

-- Tenant isolation note:
-- BeaconHS enables row-level security in `pnpm db:migrate`. If your app role
-- owns the tables, consider either forcing RLS in your deployment policy or
-- using a separate non-owner runtime role so RLS applies to application traffic.
