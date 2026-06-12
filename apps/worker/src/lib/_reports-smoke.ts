// Manual smoke test for the shared report engine (@beaconhs/reports).
// Runs a built-in report and a custom query (v2 nested filters + chart)
// against the first tenant in the database, printing result shapes.
//
//   pnpm --filter @beaconhs/worker exec tsx --env-file=../../.env src/lib/_reports-smoke.ts

import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import { tenants } from '@beaconhs/db/schema'
import { computeRangeFor, runReport } from '@beaconhs/reports'

async function main() {
  const tenant = await withSuperAdmin(db, async (tx) => {
    const [t] = await tx.select({ id: tenants.id, name: tenants.name }).from(tenants).limit(1)
    return t ?? null
  })
  if (!tenant) {
    console.log('No tenants in database — nothing to smoke test.')
    process.exit(0)
  }
  console.log(`Tenant: ${tenant.name} (${tenant.id})\n`)

  for (const queryKind of ['incidents_summary', 'safety_kpi_summary', 'incidents_trend_12m']) {
    const range = computeRangeFor(queryKind, { days: 30 })
    const result = await withTenant(db, tenant.id, (tx) =>
      runReport(tx, { queryKind, filters: { days: 30 }, range }),
    )
    console.log(
      `[built-in] ${queryKind}: rows=${result.rowCount} groups=${result.groups.length} charts=${result.charts.map((c) => `${c.id}:${c.type}(${c.xLabels.length})`).join(',') || '-'} summary=${result.summary.map((s) => `${s.label}=${s.value}`).join(' | ')}`,
    )
  }

  const customResult = await withTenant(db, tenant.id, (tx) =>
    runReport(tx, {
      queryKind: 'custom_query',
      filters: {},
      range: computeRangeFor('custom_query', {}),
      customQuery: {
        entity: 'incidents',
        columns: ['reference', 'title', 'severity', 'status', 'occurred_at'],
        filters: [],
        filtersV2: {
          combinator: 'and',
          rules: [
            { field: 'occurred_at', op: 'between_days_ago', value: 365 },
            {
              combinator: 'or',
              rules: [
                { field: 'severity', op: 'in', value: ['lost_time', 'medical_aid'] },
                { field: 'status', op: 'neq', value: 'closed' },
              ],
            },
          ],
        },
        chart: { type: 'donut', dimension: 'severity', metric: 'count' },
        groupBy: 'status',
        sort: { column: 'occurred_at', direction: 'desc' },
        limit: 100,
      },
      maxRows: 50,
    }),
  )
  console.log(
    `[custom]   incidents v2-filters: rows=${customResult.rowCount} groups=${customResult.groups.length} charts=${customResult.charts.map((c) => `${c.id}:${c.type}(${c.xLabels.length} slices)`).join(',') || '-'}`,
  )
  for (const g of customResult.groups.slice(0, 3)) {
    console.log(`           group "${g.title}" (${g.rows.length} rows)`)
  }

  console.log('\nSmoke test passed.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Smoke test FAILED:', err)
  process.exit(1)
})
