import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { RLS_POLICY_SQL, TENANT_SCOPED_TABLES } from './rls'
import { REPORT_VIEWS_SQL } from './views'
import { STATS_SQL, STATS_HIGH_VOLUME_TABLES } from './stats'
import { hashKioskPin, isKioskPinHash } from './kiosk-pin'
import { BUILTIN_ROLES, PERMISSION_CATALOGUE } from './schema'

function firstRow<T = Record<string, unknown>>(result: unknown): T | undefined {
  const rows = (result as { rows?: T[] }).rows ?? (result as T[])
  return rows[0]
}

// Keep drizzle's migration tracker in sync with the journal WITHOUT running any
// SQL, so the file-based migrator never fights the schema.
//
// Why: this app's schema is applied out-of-band by `db:push` (local dev
// iteration + the CI schema check) — drizzle-kit push records NOTHING in
// `drizzle.__drizzle_migrations`. So on a long-lived DB the file-based migrator
// drifts BEHIND the real schema, and `migrate()` tries to re-create
// already-present objects → "relation already exists" → red deploy. Recording
// every journal migration as applied makes `migrate()` a guaranteed no-op; the
// RLS + view steps in main() still run every deploy.
//
// A FRESH DB (no app schema yet) is left untouched so `migrate()` builds the
// whole schema from the migration files the normal way.
async function reconcileMigrationTracker(db: ReturnType<typeof drizzle>) {
  const appTable = firstRow<{ exists: string | null }>(
    await db.execute(sql`select to_regclass('public.tenants')::text as exists`),
  )?.exists
  if (!appTable) return

  await db.execute(sql`create schema if not exists "drizzle"`)
  await db.execute(sql`
    create table if not exists "drizzle"."__drizzle_migrations" (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `)
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
    entries?: { tag: string; when: number }[]
  }
  for (const entry of journal.entries ?? []) {
    const hash = createHash('sha256')
      .update(readFileSync(`drizzle/${entry.tag}.sql`, 'utf8'))
      .digest('hex')
    // Idempotent: only inserts the row if this migration isn't recorded yet.
    await db.execute(sql`
      insert into "drizzle"."__drizzle_migrations" ("hash", "created_at")
      select ${hash}, ${entry.when}
      where not exists (
        select 1 from "drizzle"."__drizzle_migrations" where hash = ${hash}
      )
    `)
  }
  console.log('✔ Migration tracker reconciled to journal (schema is push-managed)')
}

async function backfillKioskPinHashes(db: ReturnType<typeof drizzle>) {
  type TenantPinRow = { id: string; kiosk_pin: string | null }
  type StationPinRow = { id: string; station_pin: string | null }

  const tenantRows = (await db.execute(sql`
    select id, kiosk_pin
    from tenants
    where kiosk_pin is not null and kiosk_pin <> ''
  `)) as unknown as TenantPinRow[]
  let tenantCount = 0
  for (const row of tenantRows) {
    if (!row.kiosk_pin || isKioskPinHash(row.kiosk_pin)) continue
    const hashed = await hashKioskPin(row.kiosk_pin)
    await db.execute(sql`
      update tenants
      set kiosk_pin = ${hashed}, updated_at = now()
      where id = ${row.id}
    `)
    tenantCount++
  }

  // equipment_station_settings is tenant-scoped with FORCE ROW LEVEL SECURITY,
  // and this connection (the table owner, no app.tenant_id set) would see zero
  // rows through the policy — so lift FORCE for the backfill and restore it
  // after, same as backfillBuiltinRolePermissions below.
  await db.execute(sql`alter table "equipment_station_settings" no force row level security`)
  let stationCount = 0
  try {
    const stationRows = (await db.execute(sql`
      select id, station_pin
      from equipment_station_settings
      where station_pin is not null and station_pin <> ''
    `)) as unknown as StationPinRow[]
    for (const row of stationRows) {
      if (!row.station_pin || isKioskPinHash(row.station_pin)) continue
      const hashed = await hashKioskPin(row.station_pin)
      await db.execute(sql`
        update equipment_station_settings
        set station_pin = ${hashed}, updated_at = now()
        where id = ${row.id}
      `)
      stationCount++
    }
  } finally {
    await db.execute(sql`alter table "equipment_station_settings" force row level security`)
  }

  console.log(`✔ Kiosk PIN hashes backfilled (${tenantCount} tenant, ${stationCount} station)`)
}

async function dropRetiredPluginTables(db: ReturnType<typeof drizzle>) {
  for (const table of [
    'plugin_events',
    'plugin_runs',
    'tenant_plugin_secrets',
    'tenant_plugins',
    'plugins',
  ]) {
    await db.execute(sql.raw(`drop table if exists "${table}" cascade`))
  }
  console.log('✔ Retired plugin tables removed')
}

async function backfillBuiltinRolePermissions(db: ReturnType<typeof drizzle>) {
  const fullCatalogueJson = JSON.stringify(PERMISSION_CATALOGUE)

  await db.execute(sql`alter table "roles" no force row level security`)
  try {
    await db.execute(sql`
      update "roles"
      set "permissions" = ${fullCatalogueJson}::jsonb,
          "updated_at" = now()
      where "key" = 'tenant_admin'
        and "is_built_in" = true
        and "permissions" <> ${fullCatalogueJson}::jsonb
    `)

    for (const [key, def] of Object.entries(BUILTIN_ROLES)) {
      if (key === 'tenant_admin') continue
      const baselineJson = JSON.stringify(def.permissions)
      await db.execute(sql`
        update "roles"
        set "permissions" = (
              select coalesce(jsonb_agg("permission" order by "permission"), '[]'::jsonb)
              from (
                select distinct "permission"
                from (
                  select jsonb_array_elements_text("roles"."permissions") as "permission"
                  union
                  select jsonb_array_elements_text(${baselineJson}::jsonb) as "permission"
                ) as combined_permissions
              ) as deduped_permissions
            ),
            "updated_at" = now()
        where "key" = ${key}
          and "is_built_in" = true
          and exists (
            select 1
            from jsonb_array_elements_text(${baselineJson}::jsonb) as baseline("permission")
            where not ("roles"."permissions" ? baseline."permission")
          )
      `)
    }
  } finally {
    await db.execute(sql`alter table "roles" force row level security`)
  }

  console.log('✔ Built-in role permissions backfilled')
}

async function main() {
  // Migrations + DDL must NOT run through the PgBouncer transaction pooler
  // (the migration advisory lock + session-scoped DDL need a dedicated session)
  // and must connect as the table owner. DIRECT_DATABASE_URL targets Postgres
  // directly (port 5432); fall back to DATABASE_URL for local/un-pooled setups.
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error('DIRECT_DATABASE_URL or DATABASE_URL is required')

  const migrationClient = postgres(url, { max: 1 })
  const db = drizzle(migrationClient)

  await reconcileMigrationTracker(db)

  console.log('▶ Running drizzle migrations…')
  await migrate(db, { migrationsFolder: './drizzle' })

  console.log('▶ Backfilling kiosk PIN hashes…')
  await backfillKioskPinHashes(db)

  console.log('▶ Dropping retired plugin tables…')
  await dropRetiredPluginTables(db)

  console.log('▶ Backfilling built-in role permissions…')
  await backfillBuiltinRolePermissions(db)

  console.log('▶ Applying RLS policies…')
  // RLS_POLICY_SQL is fully idempotent (DROP POLICY IF EXISTS), so ANY error
  // here is real — and a tenant table without FORCE RLS + tenant_isolation has
  // no tenant isolation at all. Failures must turn the deploy red.
  let appliedCount = 0
  const rlsFailures: { table: string; msg: string }[] = []
  for (const table of TENANT_SCOPED_TABLES) {
    try {
      await db.execute(sql.raw(RLS_POLICY_SQL(table)))
      appliedCount++
      process.stdout.write('+')
    } catch (err) {
      // drizzle wraps the underlying postgres error in err.cause.
      const causeMsg = err instanceof Error && err.cause instanceof Error ? err.cause.message : ''
      const topMsg = err instanceof Error ? err.message : String(err)
      rlsFailures.push({ table, msg: causeMsg || topMsg })
      process.stdout.write('!')
    }
  }
  console.log(`\n  ${appliedCount}/${TENANT_SCOPED_TABLES.length} applied`)
  if (rlsFailures.length > 0) {
    console.error(`  ${rlsFailures.length} failed:`)
    for (const f of rlsFailures) {
      console.error(`    ✗ ${f.table}: ${f.msg}`)
    }
    await migrationClient.end()
    throw new Error(
      `RLS policy install failed for ${rlsFailures.length} tenant table(s) — refusing to complete the deploy without tenant isolation`,
    )
  }
  console.log('✔ RLS applied')

  console.log('▶ Applying planner statistics targets…')
  let statsApplied = 0
  const statsFailures: string[] = []
  for (const stmt of STATS_SQL) {
    try {
      await db.execute(sql.raw(stmt))
      statsApplied++
    } catch (err) {
      // A targeted column may not exist on every listed table — tolerate it.
      const causeMsg = err instanceof Error && err.cause instanceof Error ? err.cause.message : ''
      statsFailures.push(`${stmt} — ${causeMsg || (err as Error).message}`)
    }
  }
  // ANALYZE so the raised targets take effect immediately (best-effort).
  for (const table of STATS_HIGH_VOLUME_TABLES) {
    try {
      await db.execute(sql.raw(`ANALYZE ${table};`))
    } catch {
      // table may not exist yet on a partial schema — ignore.
    }
  }
  console.log(`✔ Statistics applied (${statsApplied}/${STATS_SQL.length})`)
  if (statsFailures.length > 0) {
    console.log(`  ${statsFailures.length} skipped (missing table/column):`)
    for (const f of statsFailures.slice(0, 5)) console.log(`    · ${f}`)
  }

  console.log('▶ Applying reporting views…')
  for (const viewSql of REPORT_VIEWS_SQL) {
    await db.execute(sql.raw(viewSql))
  }
  console.log('✔ Views applied')

  await migrationClient.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
