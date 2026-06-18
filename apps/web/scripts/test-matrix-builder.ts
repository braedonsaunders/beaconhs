// Live test of the visual matrix builder: run the exact spine query buildAst
// emits from a MatrixSpec (people × training_courses ⟕ latest training_record,
// coverage by expires_on). Proves the from-scratch matrix builder works.
//   pnpm --filter @beaconhs/worker exec tsx --env-file=../../.env ../web/scripts/test-matrix-builder.ts <tenantId>
import { runBhql } from '@beaconhs/analytics/server'
import { db, withTenant } from '@beaconhs/db'
import type { BhqlExpr, BhqlQuery } from '@beaconhs/db/schema'

const TENANT = process.argv[2]
const CD: BhqlExpr = { ex: 'call', fn: 'current_date', args: [] }
const coverage: BhqlExpr = {
  ex: 'agg',
  fn: 'min',
  arg: {
    ex: 'case',
    branches: [
      { when: { ex: 'isnull', arg: { ex: 'field', field: 'f.id' } }, then: { ex: 'lit', value: 'missing' } },
      { when: { ex: 'isnull', arg: { ex: 'field', field: 'f.expires_on' } }, then: { ex: 'lit', value: 'valid' } },
      { when: { ex: 'compare', op: '<', left: { ex: 'field', field: 'f.expires_on' }, right: CD }, then: { ex: 'lit', value: 'expired' } },
      { when: { ex: 'compare', op: '<=', left: { ex: 'field', field: 'f.expires_on' }, right: { ex: 'arith', op: '+', left: CD, right: { ex: 'lit', value: 90 } } }, then: { ex: 'lit', value: 'expiring' } },
    ],
    else: { ex: 'lit', value: 'valid' },
  },
}
const q: BhqlQuery = {
  version: 'bhql/1',
  display: 'pivot',
  pivot: { rows: [{ breakout: 'row' }], columns: [{ breakout: 'col' }], values: [{ measure: 'status' }] },
  stages: [
    {
      source: 'people',
      spine: {
        dimensions: [
          { alias: 'r', source: 'people' },
          { alias: 'c', source: 'training_courses' },
        ],
        facts: [
          {
            alias: 'f',
            source: 'training_records',
            on: [
              { field: 'person_id', equals: 'r.id' },
              { field: 'course_id', equals: 'c.id' },
            ],
            latestBy: [{ ref: 'completed_on', direction: 'desc' }],
          },
        ],
      },
      breakouts: [
        { alias: 'row', field: 'r.employee_no' },
        { alias: 'col', field: 'c.code' },
      ],
      aggregations: [{ kind: 'expr', alias: 'status', expr: coverage }],
      orderBy: [
        { ref: 'row', direction: 'asc' },
        { ref: 'col', direction: 'asc' },
      ],
      limit: 50_000,
    },
  ],
}

async function main() {
  if (!TENANT) {
    console.error('Pass a tenant id.')
    process.exit(1)
  }
  await withTenant(db, TENANT, async (tx) => {
    const r = await runBhql(tx, q, { maxRows: 50_000 })
    if (r.shape === 'pivot') {
      const counts: Record<string, number> = {}
      for (const row of r.cells) for (const cell of row) if (cell) counts[String(cell.status)] = (counts[String(cell.status)] ?? 0) + 1
      console.log(`matrix builder OK: ${r.rowKeys.length} rows × ${r.columnKeys.length} cols`, counts)
    } else {
      console.log('shape:', r.shape)
    }
  })
  process.exit(0)
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e)
  process.exit(1)
})
