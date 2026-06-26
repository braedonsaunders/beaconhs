// Ensure the built-in hazard-assessment builder apps (Confined Space, Arc Flash,
// Fall Protection) exist for every tenant — idempotent (onConflictDoNothing).
// Run with:
//   pnpm --filter @beaconhs/db exec tsx --env-file=../../apps/web/.env.local src/scripts/ensure-app-templates.ts

import { createSuperClient } from '../client'
import * as s from '../schema'
import { seedHazardAssessmentAppTemplates } from '../seed/hazard-assessment-app-templates'

async function main() {
  const { db, sql } = createSuperClient({ max: 1 })
  try {
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
