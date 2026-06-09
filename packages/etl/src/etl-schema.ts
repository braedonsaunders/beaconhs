// DDL for the `etl` Postgres schema. Lives in the same database as the app schema but is NOT
// tenant-scoped and is excluded from RLS — it is the migration's bookkeeping (crosswalk + run log).
// Applied by `ensureEtlSchema()` (crosswalk.ts) and idempotent.

export const ETL_SCHEMA_SQL = /* sql */ `
create schema if not exists etl;

-- legacy (source_db, source_table, source_pk) -> new uuid, with a content hash for change-detection
create table if not exists etl.id_map (
  source_db      text not null,
  source_table   text not null,
  source_pk      text not null,
  entity_type    text not null,
  tenant_id      uuid not null,
  new_id         uuid not null,
  row_hash       text,
  first_seen_at  timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  primary key (source_db, source_table, source_pk)
);
create index if not exists id_map_new_id_idx on etl.id_map (new_id);
create index if not exists id_map_entity_idx on etl.id_map (entity_type, tenant_id);

-- one row per import/sync run, for observability
create table if not exists etl.sync_runs (
  id          uuid primary key default gen_random_uuid(),
  mode        text not null,                       -- 'import' | 'sync' | 'dry-run'
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running',     -- 'running' | 'ok' | 'failed'
  stats       jsonb not null default '{}'::jsonb,  -- per-entity counts
  error       text
);

-- per source table incremental watermark (max updated_at / rowversion seen)
create table if not exists etl.table_watermarks (
  source_db     text not null,
  source_table  text not null,
  watermark_value text,
  updated_at    timestamptz not null default now(),
  primary key (source_db, source_table)
);
`
