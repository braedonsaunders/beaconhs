import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { RLS_POLICY_SQL, TENANT_SCOPED_TABLES } from './rls'
import { REPORT_VIEWS_SQL } from './views'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')

  const migrationClient = postgres(url, { max: 1 })
  const db = drizzle(migrationClient)

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
      const causeMsg =
        err instanceof Error && err.cause instanceof Error ? err.cause.message : ''
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
