// Seed the "Training matrix" as a published Insights pivot Card — the generic
// abstraction of the hand-built /training/matrix page. Idempotent (upserts by
// name). Also runs the stored card to prove it compiles + renders.
//
//   pnpm --filter @beaconhs/worker exec tsx --env-file=../../.env src/scripts/seed-insights-matrix.ts

import { and, eq, isNull } from 'drizzle-orm'
import { runBhql, validateBhql } from '@beaconhs/analytics/server'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import { insightCards, tenants, type BhqlQuery } from '@beaconhs/db/schema'

const CARD_NAME = 'Training matrix'

const QUERY: BhqlQuery = {
  version: 'bhql/1',
  display: 'pivot',
  pivot: {
    rows: [{ breakout: 'person' }],
    columns: [{ breakout: 'course' }],
    values: [{ measure: 'status' }],
  },
  stages: [
    {
      source: 'training_matrix',
      breakouts: [
        { field: 'person_name', alias: 'person' },
        { field: 'course_code', alias: 'course' },
      ],
      aggregations: [{ fn: 'min', field: 'coverage_status', alias: 'status' }],
      limit: 50_000,
    },
  ],
}

async function main() {
  validateBhql(QUERY) // fail fast if the query is invalid

  const tenant = await withSuperAdmin(db, async (tx) => {
    const rows = await tx.select({ id: tenants.id, name: tenants.name }).from(tenants)
    return rows.find((t) => /rassaun/i.test(t.name)) ?? rows[0] ?? null
  })
  if (!tenant) {
    console.log('No tenants — nothing to seed.')
    process.exit(0)
  }

  await withTenant(db, tenant.id, async (tx) => {
    const [existing] = await tx
      .select({ id: insightCards.id })
      .from(insightCards)
      .where(and(eq(insightCards.name, CARD_NAME), isNull(insightCards.deletedAt)))
      .limit(1)

    if (existing) {
      await tx
        .update(insightCards)
        .set({ query: QUERY, vizType: 'pivot', status: 'published', publishedAt: new Date() })
        .where(eq(insightCards.id, existing.id))
      console.log(`Updated card ${existing.id} (${tenant.name})`)
    } else {
      const [row] = await tx
        .insert(insightCards)
        .values({
          tenantId: tenant.id,
          createdBy: null,
          name: CARD_NAME,
          description: 'Person × course training coverage — the latest record status per cell.',
          query: QUERY,
          vizType: 'pivot',
          vizSettings: {},
          status: 'published',
          publishedAt: new Date(),
        })
        .returning({ id: insightCards.id })
      console.log(`Created card ${row?.id} (${tenant.name})`)
    }

    const result = await runBhql(tx, QUERY, { maxRows: 50_000 })
    if (result.shape === 'pivot') {
      const sample = result.cells[0]?.find((c) => c && c.status)
      console.log(
        `Renders as pivot: ${result.rowKeys.length} people × ${result.columnKeys.length} courses; sample cell = ${sample?.status ?? 'n/a'}`,
      )
    } else {
      console.log(`Renders as ${result.shape}`)
    }
  })

  console.log('Seed complete.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Seed FAILED:', err)
  process.exit(1)
})
