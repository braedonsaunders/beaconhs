// Materialise every active obligation for a tenant into compliance_status (the
// scoreboard the /compliance hub reads). The worker does this daily; this runs
// it on demand — e.g. right after the ETL imports legacy training requirements.
//
//   cd apps/web && npx tsx --env-file=../../.env scripts/materialize-compliance.ts [tenant-slug]
//
// Defaults to the `rassaun` tenant. Prints a per-obligation compliance summary.

import { eq } from 'drizzle-orm'
import { createClient, withTenant } from '@beaconhs/db'
import * as s from '@beaconhs/db/schema'
import { materializeTenant } from '@beaconhs/compliance'

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required')
  const slug = process.argv[2] ?? 'rassaun'
  const { db, sql: pg } = createClient({ url: process.env.DATABASE_URL, max: 1 })

  const [tenant] = await db
    .select({ id: s.tenants.id })
    .from(s.tenants)
    .where(eq(s.tenants.slug, slug))
    .limit(1)
  if (!tenant) throw new Error(`tenant '${slug}' not found`)

  const out = await withTenant(db, tenant.id, (tx) => materializeTenant(tx, tenant.id))
  console.log(`tenant ${slug} (${tenant.id}) — materialised ${out.length} active obligations\n`)

  const bySubject = (r: (typeof out)[number]['result']) =>
    `${r.totals.completed}/${r.totals.total} ok · ${r.totals.overdue} overdue · ${r.percent}%`
  for (const { obligation, result } of out.sort((a, b) => a.result.percent - b.result.percent)) {
    console.log(
      `  [${obligation.sourceModule}] ${obligation.title.padEnd(42)} ${bySubject(result)}`,
    )
  }
  await pg.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
