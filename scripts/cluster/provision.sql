-- BeaconHS cluster provisioning (run ONCE as a superuser on the new Postgres cluster).
-- Host: 10.0.0.85:5432  ·  superuser: postgres
--
-- Usage (from a whitelisted host, once pg_hba allows this client):
--   psql "postgres://postgres:***@10.0.0.85:5432/postgres" \
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

-- ┌────────────────────────────────────────────────────────────────────────────────────────────┐
-- │ ⚠ TENANT ISOLATION (must decide before importing TWO tenants):                               │
-- │ This app enforces tenant isolation with RLS ONLY (list queries don't filter tenant_id).      │
-- │ But a table OWNER bypasses RLS unless it is FORCED. db:migrate currently only ENABLEs RLS     │
-- │ (see packages/db/src/rls.ts RLS_POLICY_SQL) — so if the running app connects as the table     │
-- │ owner, RLS does nothing and rassaun ↔ external-training data would NOT be isolated.           │
-- │ Pick ONE before go-live:                                                                      │
-- │   (A) FORCE RLS — add `ALTER TABLE <t> FORCE ROW LEVEL SECURITY` to RLS_POLICY_SQL (1 line).  │
-- │       Simplest: one role, one DATABASE_URL; the postgres superuser (BYPASSRLS) still runs the │
-- │       ETL/migrations unaffected.  ← recommended                                               │
-- │   (B) NON-OWNER app role — tables owned by a migration role, app connects as a separate role  │
-- │       that only has DML grants (RLS then applies). Needs two connection strings.              │
-- │ Until decided, this script makes beaconhs_app the owner (matches today's single-tenant dev).  │
-- └────────────────────────────────────────────────────────────────────────────────────────────┘
