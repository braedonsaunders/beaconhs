import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { RLS_POLICY_SQL, TENANT_SCOPED_TABLES } from './rls'
import { REPORT_VIEWS_SQL } from './views'
import { STATS_SQL, STATS_HIGH_VOLUME_TABLES } from './stats'

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

  console.log('▶ Applying RLS policies…')
  let newCount = 0
  let existingCount = 0
  const realFailures: { table: string; msg: string }[] = []
  for (const table of TENANT_SCOPED_TABLES) {
    try {
      await db.execute(sql.raw(RLS_POLICY_SQL(table)))
      newCount++
      process.stdout.write('+')
    } catch (err) {
      // drizzle wraps the underlying postgres error in err.cause.
      // policy may already exist; safe to ignore on idempotent re-runs.
      const causeMsg = err instanceof Error && err.cause instanceof Error ? err.cause.message : ''
      const topMsg = err instanceof Error ? err.message : String(err)
      const combined = `${topMsg} | ${causeMsg}`
      if (/already exists/.test(combined)) {
        existingCount++
        process.stdout.write('.')
      } else {
        realFailures.push({ table, msg: causeMsg || topMsg })
      }
    }
  }
  console.log(`\n  ${newCount} newly installed, ${existingCount} already existed`)
  if (realFailures.length > 0) {
    console.error(`\n  ${realFailures.length} real failures:`)
    for (const f of realFailures) {
      console.error(`    ✗ ${f.table}: ${f.msg}`)
    }
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
