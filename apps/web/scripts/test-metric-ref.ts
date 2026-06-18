// Live test of G4b reusable-metric resolution: create a metric card, reference
// it from another card, run it (the executor loads + joins the metric), clean up.
//   pnpm --filter @beaconhs/worker exec tsx --env-file=../../.env ../web/scripts/test-metric-ref.ts <tenantId>
import { eq } from 'drizzle-orm'
import { runBhql } from '@beaconhs/analytics/server'
import { db, withTenant } from '@beaconhs/db'
import { insightCards, type BhqlQuery } from '@beaconhs/db/schema'

const TENANT = process.argv[2]
const metricQuery: BhqlQuery = {
  version: 'bhql/1',
  display: 'table',
  pivot: null,
  stages: [{ source: 'journal_entries', aggregations: [{ fn: 'count', alias: 'n' }] }],
}

async function main() {
  if (!TENANT) {
    console.error('Pass a tenant id.')
    process.exit(1)
  }
  await withTenant(db, TENANT, async (tx) => {
    const [m] = await tx
      .insert(insightCards)
      .values({
        tenantId: TENANT,
        createdBy: null,
        name: 'TEST journal-entries metric',
        kind: 'metric',
        query: metricQuery,
        vizType: 'scalar',
        status: 'published',
      })
      .returning({ id: insightCards.id })
    const metricId = m!.id
    try {
      const refQuery: BhqlQuery = {
        version: 'bhql/1',
        display: 'table',
        pivot: null,
        stages: [
          {
            source: 'people',
            aggregations: [
              { fn: 'count', alias: 'ppl' },
              { kind: 'calc', alias: 'ratio', numerator: 'ppl', denominator: 'jrn', multiplier: 1 },
            ],
            metricRefs: [{ metricId, alias: 'jrn', on: [] }],
          },
        ],
      }
      const r = await runBhql(tx, refQuery, { maxRows: 10 })
      console.log('metricRef resolved + ran:', JSON.stringify(r.shape === 'flat' ? r.rows : r.shape))
    } finally {
      await tx
        .update(insightCards)
        .set({ deletedAt: new Date() })
        .where(eq(insightCards.id, metricId))
      console.log('cleaned up the test metric card')
    }
  })
  process.exit(0)
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e)
  process.exit(1)
})
