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

-- 6) Dedicated BYPASSRLS runtime role for cross-tenant / super-admin / ETL access.
--    The tenant RLS policy (installed by `pnpm db:migrate`) is a single, index-usable
--    equality on tenant_id with NO "OR bypass" branch — the bypass is a ROLE attribute
--    here, not a session GUC, so the planner can use the (tenant_id, …) indexes.
--    withSuperAdmin() connects as this role; withTenant() (app traffic) connects as the
--    non-bypass owner role above, which FORCE RLS keeps tenant-scoped.
--    Usage: -v super_password="'CHANGE_ME_STRONG'".
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'beaconhs_super') THEN
    EXECUTE format('CREATE ROLE beaconhs_super LOGIN BYPASSRLS PASSWORD %L', :'super_password');
  ELSE
    EXECUTE 'ALTER ROLE beaconhs_super LOGIN BYPASSRLS';
  END IF;
END $$;
-- Same idle-in-transaction safety net as the app role (replicates via WAL).
ALTER ROLE beaconhs_super SET idle_in_transaction_session_timeout = '5min';
ALTER ROLE beaconhs_super SET tcp_keepalives_idle = '60';
ALTER ROLE beaconhs_super SET tcp_keepalives_interval = '10';
ALTER ROLE beaconhs_super SET tcp_keepalives_count = '6';
GRANT CONNECT ON DATABASE beaconhs TO beaconhs_super;
-- Membership in the owner role lets super manage owner-owned tables (DDL in
-- one-off scripts) in addition to its BYPASSRLS DML/reads.
GRANT beaconhs_app TO beaconhs_super;
GRANT USAGE ON SCHEMA public TO beaconhs_super;
GRANT USAGE ON SCHEMA etl    TO beaconhs_super;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO beaconhs_super;
GRANT ALL ON ALL TABLES    IN SCHEMA etl    TO beaconhs_super;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO beaconhs_super;
GRANT ALL ON ALL SEQUENCES IN SCHEMA etl    TO beaconhs_super;
ALTER DEFAULT PRIVILEGES FOR ROLE beaconhs_app   IN SCHEMA public GRANT ALL ON TABLES    TO beaconhs_super;
ALTER DEFAULT PRIVILEGES FOR ROLE beaconhs_app   IN SCHEMA public GRANT ALL ON SEQUENCES TO beaconhs_super;
ALTER DEFAULT PRIVILEGES FOR ROLE beaconhs_app   IN SCHEMA etl    GRANT ALL ON TABLES    TO beaconhs_super;
ALTER DEFAULT PRIVILEGES FOR ROLE beaconhs_super IN SCHEMA public GRANT ALL ON TABLES    TO beaconhs_app;
ALTER DEFAULT PRIVILEGES FOR ROLE beaconhs_super IN SCHEMA public GRANT ALL ON SEQUENCES TO beaconhs_app;

-- Tenant isolation model:
-- `pnpm db:migrate` enables FORCE ROW LEVEL SECURITY + the tenant_isolation policy on every
-- tenant-scoped table. App traffic connects as the non-owner-bypass role beaconhs_app (FORCE RLS
-- applies) and sets app.tenant_id per request; cross-tenant traffic connects as beaconhs_super
-- (BYPASSRLS). Runtime traffic is pooled through PgBouncer (transaction mode, port 6432); the
-- migrate/DDL path connects directly (port 5432) as the owner.
