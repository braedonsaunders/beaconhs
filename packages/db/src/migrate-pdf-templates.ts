// One-off, idempotent: create the pdf_templates table + its enums on a
// push-managed dev DB (safer than a blanket drizzle push when the DB is
// drifted). Run `pnpm db:migrate` afterward to install the RLS policy (the
// table is registered in TENANT_SCOPED_TABLES).
//
//   pnpm --filter @beaconhs/db exec tsx --env-file=../../.env \
//     src/migrate-pdf-templates.ts

import { sql } from 'drizzle-orm'
import { createClient, withSuperAdmin } from './index'

async function main() {
  const { db, sql: pg } = createClient({ max: 4 })
  try {
    await withSuperAdmin(db, async (tx) => {
      await tx.execute(
        sql`DO $$ BEGIN CREATE TYPE pdf_paper_size AS ENUM ('letter','a4','legal'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
      )
      await tx.execute(
        sql`DO $$ BEGIN CREATE TYPE pdf_orientation AS ENUM ('portrait','landscape'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
      )
      await tx.execute(sql`CREATE TABLE IF NOT EXISTS pdf_templates (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references tenants(id) on delete cascade,
        key text not null,
        name text not null,
        description text,
        record_subject_type text,
        record_subject_key text,
        paper_size pdf_paper_size not null default 'letter',
        orientation pdf_orientation not null default 'portrait',
        margin_mm integer not null default 16,
        header_html text,
        footer_html text,
        design jsonb not null default '{}'::jsonb,
        compiled_html text not null default '',
        source_html text,
        merge_fields jsonb not null default '[]'::jsonb,
        is_active boolean not null default true,
        created_by_tenant_user_id uuid references tenant_users(id),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        deleted_at timestamptz
      )`)
      await tx.execute(
        sql`CREATE INDEX IF NOT EXISTS pdf_templates_tenant_idx ON pdf_templates(tenant_id)`,
      )
      await tx.execute(
        sql`CREATE UNIQUE INDEX IF NOT EXISTS pdf_templates_tenant_key_ux ON pdf_templates(tenant_id, key)`,
      )
      await tx.execute(
        sql`CREATE INDEX IF NOT EXISTS pdf_templates_subject_idx ON pdf_templates(tenant_id, record_subject_type, record_subject_key)`,
      )
    })
    console.log('✔ pdf_templates table + enums ensured.')
  } finally {
    await pg.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
