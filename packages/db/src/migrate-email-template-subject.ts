// One-off, idempotent: tie email_templates to a record type (module/app) so the
// builder can expose that type's full field set. db:push --force SKIPs ALTERs on
// the RLS-policy email_templates table, so add the columns surgically.
//
//   pnpm --filter @beaconhs/db exec tsx --env-file=../../.env \
//     src/migrate-email-template-subject.ts

import { sql } from 'drizzle-orm'
import { createClient, withSuperAdmin } from './index'

async function main() {
  const { db, sql: pg } = createClient({ max: 4 })
  try {
    await withSuperAdmin(db, async (tx) => {
      await tx.execute(
        sql`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS record_subject_type text`,
      )
      await tx.execute(
        sql`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS record_subject_key text`,
      )
    })
    console.log('✔ email_templates: record_subject_type / record_subject_key ensured.')
  } finally {
    await pg.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
