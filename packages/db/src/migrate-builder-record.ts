// One-off, idempotent migration for the BUILDER-APP RECORD-PAGE rework (P0 DB
// foundation). Applies ONLY these additive columns so it never touches
// unrelated drift on the push-managed dev DB:
//   • form_responses → record-level lock (locked / locked_at / locked_by_*)
//   • form_templates → record_config (app-level record behaviour config)
//
// Why this script exists: `db:push --force` SKIPS ALTERs on tables that carry
// RLS policies (form_responses + form_templates do), so these columns must be
// applied surgically here rather than via push.
//
// Run BEFORE `db:migrate` (which restores the RLS policies db:push --force
// would otherwise drop):
//
//   pnpm --filter @beaconhs/db exec tsx --env-file=../../.env \
//     src/migrate-builder-record.ts
//   pnpm --filter @beaconhs/db migrate
//
// Idempotent + safe to re-run. DDL matches the drizzle schema so a later
// `db:push` sees no diff.

import { sql } from 'drizzle-orm'
import { createClient, withSuperAdmin } from './index'

async function main() {
  const { db, sql: pg } = createClient({ max: 4 })
  try {
    await withSuperAdmin(db, async (tx) => {
      // --- form_responses → record-level lock ---------------------------------
      await tx.execute(sql`
        ALTER TABLE form_responses
          ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false
      `)
      await tx.execute(
        sql`ALTER TABLE form_responses ADD COLUMN IF NOT EXISTS locked_at timestamptz`,
      )
      await tx.execute(sql`
        ALTER TABLE form_responses ADD COLUMN IF NOT EXISTS locked_by_tenant_user_id uuid
      `)

      // --- form_templates → record_config -------------------------------------
      await tx.execute(sql`
        ALTER TABLE form_templates ADD COLUMN IF NOT EXISTS record_config jsonb
      `)

      console.log(
        '✔ builder-record schema ensured (form_responses lock columns + form_templates.record_config ready).',
      )
    })
  } finally {
    await pg.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
