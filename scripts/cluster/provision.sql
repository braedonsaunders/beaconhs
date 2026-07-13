-- BeaconHS database provisioning (run as a PostgreSQL superuser).
--
-- Usage:
--   psql "postgresql://postgres:***@localhost:5432/postgres" \
--     -v app_password='CHANGE_ME_APP' \
--     -v super_password='CHANGE_ME_SUPER' \
--     -v migrator_password='CHANGE_ME_MIGRATOR' \
--     -v backup_password='CHANGE_ME_BACKUP' \
--     -f scripts/cluster/provision.sql
--
-- Role model:
--   beaconhs_owner     NOLOGIN owner of database/schema/application objects
--   beaconhs_migrator  LOGIN; can SET ROLE beaconhs_owner; never used by app
--   beaconhs_app       LOGIN; tenant-scoped runtime DML; no ownership/bypass
--   beaconhs_super     LOGIN; cross-tenant DML with BYPASSRLS; no ownership
--   beaconhs_backup    LOGIN; read-only logical backup with BYPASSRLS

\set ON_ERROR_STOP on

SELECT 'CREATE ROLE beaconhs_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'beaconhs_owner')
\gexec
ALTER ROLE beaconhs_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

SELECT format(
  'CREATE ROLE beaconhs_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'migrator_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'beaconhs_migrator')
\gexec
ALTER ROLE beaconhs_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
SELECT format('ALTER ROLE beaconhs_migrator PASSWORD %L', :'migrator_password') \gexec

SELECT format(
  'CREATE ROLE beaconhs_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'beaconhs_app')
\gexec
ALTER ROLE beaconhs_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
SELECT format('ALTER ROLE beaconhs_app PASSWORD %L', :'app_password') \gexec

SELECT format(
  'CREATE ROLE beaconhs_super LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS PASSWORD %L',
  :'super_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'beaconhs_super')
\gexec
ALTER ROLE beaconhs_super LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
SELECT format('ALTER ROLE beaconhs_super PASSWORD %L', :'super_password') \gexec

SELECT format(
  'CREATE ROLE beaconhs_backup LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS PASSWORD %L',
  :'backup_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'beaconhs_backup')
\gexec
ALTER ROLE beaconhs_backup LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
SELECT format('ALTER ROLE beaconhs_backup PASSWORD %L', :'backup_password') \gexec

-- The migrator must opt into ownership explicitly. Runtime roles must never be
-- owner members; remove the old super -> app membership during upgrades.
SELECT 'GRANT beaconhs_owner TO beaconhs_migrator'
WHERE NOT pg_has_role('beaconhs_migrator', 'beaconhs_owner', 'MEMBER')
\gexec
SELECT format('REVOKE %I FROM %I', parent.rolname, member.rolname)
FROM pg_auth_members membership
JOIN pg_roles parent ON parent.oid = membership.roleid
JOIN pg_roles member ON member.oid = membership.member
WHERE (
    parent.rolname = 'beaconhs_owner'
    AND member.rolname IN ('beaconhs_app', 'beaconhs_super', 'beaconhs_backup')
  )
   OR (
     parent.rolname = 'beaconhs_app'
     AND member.rolname IN ('beaconhs_super', 'beaconhs_backup')
   )
\gexec

SELECT 'CREATE DATABASE beaconhs OWNER beaconhs_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'beaconhs')
\gexec
ALTER DATABASE beaconhs OWNER TO beaconhs_owner;
ALTER DATABASE beaconhs SET timezone TO 'UTC';

REVOKE ALL PRIVILEGES ON DATABASE beaconhs FROM PUBLIC;
GRANT CONNECT ON DATABASE beaconhs TO beaconhs_migrator, beaconhs_app, beaconhs_super, beaconhs_backup;

\connect beaconhs

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Existing installations used beaconhs_app as owner. Transfer every object in
-- this database before reducing the app login to DML-only privileges.
REASSIGN OWNED BY beaconhs_app TO beaconhs_owner;
ALTER SCHEMA public OWNER TO beaconhs_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC, beaconhs_app, beaconhs_super;
GRANT USAGE ON SCHEMA public TO beaconhs_app, beaconhs_super, beaconhs_backup;

-- Private ETL bookkeeping is intentionally isolated from runtime traffic. The
-- BYPASSRLS maintenance login may create and maintain only this schema.
CREATE SCHEMA IF NOT EXISTS etl AUTHORIZATION beaconhs_owner;
ALTER SCHEMA etl OWNER TO beaconhs_owner;
REVOKE ALL ON SCHEMA etl FROM PUBLIC, beaconhs_app;
GRANT USAGE, CREATE ON SCHEMA etl TO beaconhs_super;
GRANT USAGE ON SCHEMA etl TO beaconhs_backup;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM beaconhs_app, beaconhs_super;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO beaconhs_app, beaconhs_super;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM beaconhs_app, beaconhs_super;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO beaconhs_app, beaconhs_super;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO beaconhs_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO beaconhs_backup;

-- The migration tracker schema exists only after the first migration run.
SELECT 'GRANT USAGE ON SCHEMA drizzle TO beaconhs_backup'
WHERE to_regnamespace('drizzle') IS NOT NULL
\gexec
SELECT 'GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO beaconhs_backup'
WHERE to_regnamespace('drizzle') IS NOT NULL
\gexec
SELECT 'GRANT SELECT ON ALL SEQUENCES IN SCHEMA drizzle TO beaconhs_backup'
WHERE to_regnamespace('drizzle') IS NOT NULL
\gexec

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA etl TO beaconhs_super;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA etl TO beaconhs_super;
GRANT SELECT ON ALL TABLES IN SCHEMA etl TO beaconhs_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA etl TO beaconhs_backup;

ALTER DEFAULT PRIVILEGES FOR ROLE beaconhs_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO beaconhs_app, beaconhs_super;
ALTER DEFAULT PRIVILEGES FOR ROLE beaconhs_owner IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO beaconhs_app, beaconhs_super;
ALTER DEFAULT PRIVILEGES FOR ROLE beaconhs_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO beaconhs_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE beaconhs_owner IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO beaconhs_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE beaconhs_owner IN SCHEMA etl
  GRANT ALL PRIVILEGES ON TABLES TO beaconhs_super;
ALTER DEFAULT PRIVILEGES FOR ROLE beaconhs_owner IN SCHEMA etl
  GRANT ALL PRIVILEGES ON SEQUENCES TO beaconhs_super;
ALTER DEFAULT PRIVILEGES FOR ROLE beaconhs_super IN SCHEMA etl
  GRANT ALL PRIVILEGES ON TABLES TO beaconhs_super;
ALTER DEFAULT PRIVILEGES FOR ROLE beaconhs_super IN SCHEMA etl
  GRANT ALL PRIVILEGES ON SEQUENCES TO beaconhs_super;
ALTER DEFAULT PRIVILEGES FOR ROLE beaconhs_owner IN SCHEMA etl
  GRANT SELECT ON TABLES TO beaconhs_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE beaconhs_owner IN SCHEMA etl
  GRANT SELECT ON SEQUENCES TO beaconhs_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE beaconhs_super IN SCHEMA etl
  GRANT SELECT ON TABLES TO beaconhs_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE beaconhs_super IN SCHEMA etl
  GRANT SELECT ON SEQUENCES TO beaconhs_backup;

-- Connection hygiene applies equally to the three login roles.
ALTER ROLE beaconhs_migrator SET idle_in_transaction_session_timeout = '5min';
ALTER ROLE beaconhs_app SET idle_in_transaction_session_timeout = '5min';
ALTER ROLE beaconhs_super SET idle_in_transaction_session_timeout = '5min';
ALTER ROLE beaconhs_backup SET default_transaction_read_only = 'on';
ALTER ROLE beaconhs_backup SET idle_in_transaction_session_timeout = '5min';
ALTER ROLE beaconhs_migrator SET tcp_keepalives_idle = '60';
ALTER ROLE beaconhs_app SET tcp_keepalives_idle = '60';
ALTER ROLE beaconhs_super SET tcp_keepalives_idle = '60';
ALTER ROLE beaconhs_backup SET tcp_keepalives_idle = '60';
ALTER ROLE beaconhs_migrator SET tcp_keepalives_interval = '10';
ALTER ROLE beaconhs_app SET tcp_keepalives_interval = '10';
ALTER ROLE beaconhs_super SET tcp_keepalives_interval = '10';
ALTER ROLE beaconhs_backup SET tcp_keepalives_interval = '10';
ALTER ROLE beaconhs_migrator SET tcp_keepalives_count = '6';
ALTER ROLE beaconhs_app SET tcp_keepalives_count = '6';
ALTER ROLE beaconhs_super SET tcp_keepalives_count = '6';
ALTER ROLE beaconhs_backup SET tcp_keepalives_count = '6';
