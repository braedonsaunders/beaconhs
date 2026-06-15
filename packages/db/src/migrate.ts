import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { RLS_POLICY_SQL, TENANT_SCOPED_TABLES } from './rls'
import { REPORT_VIEWS_SQL } from './views'

function firstRow<T = Record<string, unknown>>(result: unknown): T | undefined {
  const rows = (result as { rows?: T[] }).rows ?? (result as T[])
  return rows[0]
}

function baselineMigration() {
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
    entries?: { tag: string; when: number }[]
  }
  const entry = journal.entries?.[0]
  if (!entry) throw new Error('No baseline migration found in drizzle journal')
  const hash = createHash('sha256')
    .update(readFileSync(`drizzle/${entry.tag}.sql`, 'utf8'))
    .digest('hex')
  return { ...entry, hash }
}

async function reconcileFlattenedBaseline(db: ReturnType<typeof drizzle>) {
  const appTable = firstRow<{ exists: string | null }>(
    await db.execute(sql`select to_regclass('public.tenants')::text as exists`),
  )?.exists
  if (!appTable) return

  const baseline = baselineMigration()
  const migrationTable = firstRow<{ exists: string | null }>(
    await db.execute(sql`select to_regclass('drizzle.__drizzle_migrations')::text as exists`),
  )?.exists

  if (migrationTable) {
    // If the flattened baseline is already recorded, the tracker is valid —
    // whether the DB sits exactly at the baseline OR has later migrations
    // (0001, 0002, …) applied on top. Trust it and let migrate() apply only
    // what's unapplied. Resetting here would re-run every post-baseline
    // migration from scratch and fail on the first non-idempotent CREATE.
    // Only the genuinely stale/empty-tracker case (baseline hash absent) falls
    // through to the reset below.
    const baselineRecorded = firstRow<{ ok: number }>(
      await db.execute(sql`
        select 1 as ok from "drizzle"."__drizzle_migrations" where hash = ${baseline.hash} limit 1
      `),
    )
    if (baselineRecorded) return
  }

  console.log('▶ Existing schema detected; reconciling flattened drizzle baseline…')
  await db.execute(sql`create schema if not exists "drizzle"`)
  await db.execute(sql`
    create table if not exists "drizzle"."__drizzle_migrations" (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `)
  await db.execute(sql`delete from "drizzle"."__drizzle_migrations"`)
  await db.execute(sql`
    insert into "drizzle"."__drizzle_migrations" ("hash", "created_at")
    values (${baseline.hash}, ${baseline.when})
  `)
  console.log(`✔ Baseline reconciled: ${baseline.tag}`)
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')

  const migrationClient = postgres(url, { max: 1 })
  const db = drizzle(migrationClient)

  await reconcileFlattenedBaseline(db)

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
