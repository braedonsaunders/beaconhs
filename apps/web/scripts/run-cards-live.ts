// Run selected built-in cards LIVE under a tenant (proves they execute, not just
// compile). Usage:
//   pnpm --filter @beaconhs/worker exec tsx --env-file=../../.env ../web/scripts/run-cards-live.ts <tenantId>
import { runBhql } from '@beaconhs/analytics/server'
import { db, withTenant } from '@beaconhs/db'
import { BUILTIN_QUERIES } from '../src/app/(app)/insights/_widgets'

const TENANT = process.argv[2]
const KEYS = [
  'kpi-days-recordable',
  'chart-ca-aging',
  'journal-by-dow',
  'chart-trir',
  'chart-dart',
  'kpi-doc-compliance',
  'kpi-training-compliance',
]

async function main() {
  if (!TENANT) {
    console.error('Pass a tenant id.')
    process.exit(1)
  }
  await withTenant(db, TENANT, async (tx) => {
    for (const k of KEYS) {
      const b = BUILTIN_QUERIES[k]
      if (!b) {
        console.log(`SKIP ${k} (not found)`)
        continue
      }
      try {
        const r = await runBhql(tx, b.query, { maxRows: 5_000 })
        const sample =
          r.shape === 'flat'
            ? JSON.stringify(r.rows.slice(0, 2))
            : `pivot ${r.rowKeys.length}×${r.columnKeys.length}`
        console.log(`OK   ${k}: ${r.shape}, ${r.rowCount} rows — ${sample}`)
      } catch (e) {
        console.log(`FAIL ${k}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  })
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
