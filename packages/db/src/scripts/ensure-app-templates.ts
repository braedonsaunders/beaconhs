// Ensure the built-in hazard-assessment builder apps (Confined Space, Arc Flash,
// Fall Protection) exist for every tenant — idempotent (onConflictDoNothing).
// Run with:
//   pnpm --filter @beaconhs/db exec tsx --env-file=../../apps/web/.env.local src/scripts/ensure-app-templates.ts

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as s from '../schema'
import { seedHazardAssessmentAppTemplates } from '../seed/hazard-assessment-app-templates'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL required')
  const sql = postgres(url, { max: 1 })
  const db = drizzle(sql, { schema: s })
  try {
    await sql`select set_config('app.bypass_rls', 'on', false)`
    const tenants = await db.select({ id: s.tenants.id }).from(s.tenants)
    const out: unknown[] = []
    for (const t of tenants) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ids = await seedHazardAssessmentAppTemplates(db as any, t.id)
      out.push({ tenantId: t.id, ...ids })
    }
    console.log(JSON.stringify({ tenants: tenants.length, results: out }, null, 2))
  } finally {
    await sql.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
