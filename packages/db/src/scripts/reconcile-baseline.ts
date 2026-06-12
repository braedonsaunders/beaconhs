// One-off: after squashing the migration history into a single 0000_init
// baseline, tell the (already-migrated) dev DB that the baseline is applied —
// WITHOUT re-running it. Drizzle's migrator gates on `created_at` (the journal
// `when`), so we replace __drizzle_migrations with a single row whose
// created_at == the baseline's when. Touches ONLY drizzle's bookkeeping, never
// data tables.
//
//   cd packages/db && DATABASE_URL='postgresql://beaconhs:beaconhs@localhost:5433/beaconhs' npx tsx src/scripts/reconcile-baseline.ts

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { createClient } from '../client'

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required')
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'))
  const entry = journal.entries[0]
  if (!entry) throw new Error('no baseline journal entry')
  const when: number = entry.when
  const hash = createHash('sha256')
    .update(readFileSync('drizzle/0000_init.sql', 'utf8'))
    .digest('hex')

  const { db, sql: pg } = createClient({ url: process.env.DATABASE_URL, max: 1 })
  await db.execute(sql`create schema if not exists "drizzle"`)
  await db.execute(
    sql`create table if not exists "drizzle"."__drizzle_migrations" (id serial primary key, hash text not null, created_at bigint)`,
  )
  await db.execute(sql`delete from "drizzle"."__drizzle_migrations"`)
  await db.execute(
    sql`insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values (${hash}, ${when})`,
  )
  const rows = await db.execute(
    sql`select hash, created_at from "drizzle"."__drizzle_migrations" order by created_at desc`,
  )
  console.log(`✔ reconciled: ${entry.tag} @ ${when}; rows now:`, rows)
  await pg.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
