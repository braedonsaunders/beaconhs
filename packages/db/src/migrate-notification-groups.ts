// One-off, idempotent: create the notification_groups + notification_group_members
// tables (+ enums, indexes, RLS) and add tenant_notification_settings.group_ids,
// for the reusable-audience feature. Safe to re-run.
//
//   DATABASE_URL=<your-db-url> pnpm --filter @beaconhs/db exec tsx src/migrate-notification-groups.ts

import { sql } from 'drizzle-orm'
import { createClient, withSuperAdmin } from './index'
import { RLS_POLICY_SQL } from './rls'

async function main() {
  const { db, sql: pg } = createClient({ max: 4 })
  try {
    await withSuperAdmin(db, async (tx) => {
      // Enums (CREATE TYPE has no IF NOT EXISTS).
      await tx.execute(sql`
        DO $$ BEGIN
          CREATE TYPE notification_group_member_kind AS ENUM
            ('everyone','person','role','department','org_unit','trade','crew','person_group');
        EXCEPTION WHEN duplicate_object THEN null; END $$;`)
      await tx.execute(sql`
        DO $$ BEGIN
          CREATE TYPE notification_group_member_mode AS ENUM ('include','exclude');
        EXCEPTION WHEN duplicate_object THEN null; END $$;`)

      await tx.execute(sql`
        CREATE TABLE IF NOT EXISTS notification_groups (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name text NOT NULL,
          description text,
          color text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          deleted_at timestamptz
        );`)
      await tx.execute(
        sql`CREATE INDEX IF NOT EXISTS notification_groups_tenant_idx ON notification_groups (tenant_id);`,
      )
      await tx.execute(
        sql`CREATE UNIQUE INDEX IF NOT EXISTS notification_groups_tenant_name_ux ON notification_groups (tenant_id, name);`,
      )

      await tx.execute(sql`
        CREATE TABLE IF NOT EXISTS notification_group_members (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          group_id uuid NOT NULL REFERENCES notification_groups(id) ON DELETE CASCADE,
          kind notification_group_member_kind NOT NULL,
          entity_key text NOT NULL DEFAULT '',
          mode notification_group_member_mode NOT NULL DEFAULT 'include',
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );`)
      await tx.execute(
        sql`CREATE INDEX IF NOT EXISTS notification_group_members_tenant_idx ON notification_group_members (tenant_id);`,
      )
      await tx.execute(
        sql`CREATE INDEX IF NOT EXISTS notification_group_members_group_idx ON notification_group_members (group_id);`,
      )
      await tx.execute(
        sql`CREATE UNIQUE INDEX IF NOT EXISTS notification_group_members_unique_ux ON notification_group_members (group_id, kind, entity_key, mode);`,
      )

      // Cockpit can target groups per category.
      await tx.execute(
        sql`ALTER TABLE tenant_notification_settings ADD COLUMN IF NOT EXISTS group_ids jsonb NOT NULL DEFAULT '[]'::jsonb;`,
      )

      // RLS (FORCE) for the two new tenant-scoped tables.
      await tx.execute(sql.raw(RLS_POLICY_SQL('notification_groups')))
      await tx.execute(sql.raw(RLS_POLICY_SQL('notification_group_members')))
    })
    console.log('✔ notification_groups + members + group_ids + RLS ensured.')
  } finally {
    await pg.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
