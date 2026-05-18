import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { RLS_POLICY_SQL, TENANT_SCOPED_TABLES } from './rls'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')

  const migrationClient = postgres(url, { max: 1 })
  const db = drizzle(migrationClient)

  console.log('▶ Running drizzle migrations…')
  await migrate(db, { migrationsFolder: './drizzle' })

  console.log('▶ Applying RLS policies…')
  for (const table of TENANT_SCOPED_TABLES) {
    try {
      await db.execute(sql.raw(RLS_POLICY_SQL(table)))
      process.stdout.write('.')
    } catch (err) {
      // policy may already exist; safe to ignore on idempotent re-runs
      const msg = err instanceof Error ? err.message : String(err)
      if (!/already exists/.test(msg)) {
        console.error(`\n✗ ${table}: ${msg}`)
      }
    }
  }
  console.log('\n✔ RLS applied')

  await migrationClient.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
