// One-off, idempotent: add the admin-impersonation overlay columns to the
// Better-Auth `session` table on a push-managed dev DB (safer than a blanket
// drizzle push when the DB is drifted). The session table is global (no RLS),
// so there's nothing to register in TENANT_SCOPED_TABLES afterward.
//
//   pnpm --filter @beaconhs/db exec tsx --env-file=../../.env \
//     src/migrate-impersonation.ts

import { sql } from 'drizzle-orm'
import { createClient, withSuperAdmin } from './index'

async function main() {
  const { db, sql: pg } = createClient({ max: 4 })
  try {
    await withSuperAdmin(db, async (tx) => {
      await tx.execute(
        sql`ALTER TABLE session ADD COLUMN IF NOT EXISTS impersonating_user_id text REFERENCES "user"(id) ON DELETE SET NULL`,
      )
      await tx.execute(
        sql`ALTER TABLE session ADD COLUMN IF NOT EXISTS impersonation_tenant_id uuid`,
      )
      await tx.execute(
        sql`ALTER TABLE session ADD COLUMN IF NOT EXISTS impersonation_started_at timestamptz`,
      )
      await tx.execute(
        sql`ALTER TABLE session ADD COLUMN IF NOT EXISTS impersonation_expires_at timestamptz`,
      )
      await tx.execute(sql`ALTER TABLE session ADD COLUMN IF NOT EXISTS impersonation_reason text`)
    })
    console.log('✔ session impersonation columns ensured.')
  } finally {
    await pg.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
