// Manual smoke test for the shared report engine (@beaconhs/reports).
// Runs a built-in report and a custom query (v2 nested filters + chart)
// against the first tenant in the database, printing result shapes.
//
//   pnpm --filter @beaconhs/worker exec tsx --env-file=../../.env src/lib/_reports-smoke.ts

import { sql } from 'drizzle-orm'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import { incidents, tenants } from '@beaconhs/db/schema'
import { computeRangeFor, runReport } from '@beaconhs/reports'
import { discoverEntityMap } from '@beaconhs/analytics/server'

async function main() {
  // Prefer a tenant that actually has incident data so the aggregation smoke is
  // meaningful (falls back to the first tenant).
  const tenant = await withSuperAdmin(db, async (tx) => {
    const rows = await tx.select({ id: tenants.id, name: tenants.name }).from(tenants)
    for (const t of rows) {
      const [c] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(incidents)
        .where(sql`${incidents.tenantId} = ${t.id}`)
      if (Number(c?.n ?? 0) > 0) return t
    }
    return rows[0] ?? null
  })
  if (!tenant) {
    console.log('No tenants in database — nothing to smoke test.')
    process.exit(0)
  }
  console.log(`Tenant: ${tenant.name} (${tenant.id})\n`)

  for (const queryKind of [
    'incidents_summary',
    'safety_kpi_summary',
    'incidents_trend_12m',
    'osha_300_log',
  ]) {
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

  // --- NEW: summarize (aggregation) mode + discovered-only entity ----------
  const entityMap = discoverEntityMap()
  console.log(`\nDiscovered entity catalog: ${Object.keys(entityMap).length} entities`)

  // Summarize: incidents grouped by severity with a count measure.
  const aggResult = await withTenant(db, tenant.id, (tx) =>
    runReport(tx, {
      queryKind: 'custom_query',
      filters: {},
      range: computeRangeFor('custom_query', {}),
      entityMap,
      customQuery: {
        entity: 'incidents',
        mode: 'summarize',
        columns: [],
        breakouts: [{ column: 'severity' }],
        measures: [{ fn: 'count' }],
        chart: { type: 'bar', dimension: 'severity', metric: 'count' },
        limit: 100,
      },
      maxRows: 100,
    }),
  )
  const aggGroup = aggResult.groups[0]
  console.log(
    `[summarize] incidents by severity: groups=${aggResult.rowCount} cols=[${aggGroup?.columns.join(' | ')}] sample=${JSON.stringify(aggGroup?.rows.slice(0, 5))} summary=${aggResult.summary.map((s) => `${s.label}=${s.value}`).join(' | ')}`,
  )

  // Summarize with a temporal bin (the trend report, long-form).
  const trendResult = await withTenant(db, tenant.id, (tx) =>
    runReport(tx, {
      queryKind: 'custom_query',
      filters: {},
      range: computeRangeFor('custom_query', {}),
      entityMap,
      customQuery: {
        entity: 'incidents',
        mode: 'summarize',
        columns: [],
        breakouts: [{ column: 'occurred_at', bin: 'month' }, { column: 'severity' }],
        measures: [{ fn: 'count' }],
        limit: 100,
      },
      maxRows: 100,
    }),
  )
  console.log(
    `[summarize] incidents by month×severity: groups=${trendResult.rowCount} sample=${JSON.stringify(trendResult.groups[0]?.rows.slice(0, 5))}`,
  )

  // Discovered-only entity: `people` is never in the static registry — proves
  // the injected catalog unlocks every tenant-scoped table.
  const peopleResult = await withTenant(db, tenant.id, (tx) =>
    runReport(tx, {
      queryKind: 'custom_query',
      filters: {},
      range: computeRangeFor('custom_query', {}),
      entityMap,
      customQuery: {
        entity: 'people',
        mode: 'rows',
        columns: ['first_name', 'last_name', 'employee_no'],
        limit: 10,
      },
      maxRows: 10,
    }),
  )
  console.log(
    `[discovered] people (not in static registry): rows=${peopleResult.rowCount} cols=[${peopleResult.groups[0]?.columns.join(' | ')}]`,
  )

  console.log('\nSmoke test passed.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Smoke test FAILED:', err)
  process.exit(1)
})
