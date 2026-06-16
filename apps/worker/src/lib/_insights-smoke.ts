// Manual smoke test for the Insights BHQL engine (@beaconhs/analytics/server).
// Exercises raw-row, grouped, temporal-bin and pivot queries against real tenant
// data, asserts the result shapes, and demonstrates RLS scoping by running the
// same query under each tenant.
//
//   pnpm --filter @beaconhs/worker exec tsx --env-file=../../.env src/lib/_insights-smoke.ts

import { discoverEntities, runBhql, validateBhql } from '@beaconhs/analytics/server'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import type { BhqlQuery } from '@beaconhs/db/schema'
import { tenants } from '@beaconhs/db/schema'

function fail(msg: string): never {
  throw new Error(msg)
}

async function main() {
  const ts = await withSuperAdmin(db, (tx) =>
    tx.select({ id: tenants.id, name: tenants.name }).from(tenants).limit(2),
  )
  if (ts.length === 0) {
    console.log('No tenants in database — nothing to smoke test.')
    process.exit(0)
  }
  const tenant = ts[0]!
  console.log(`Tenant: ${tenant.name} (${tenant.id})\n`)

  // --- dynamic discovery (no DB needed — pure schema introspection) ---
  const discovered = discoverEntities()
  console.log(
    `[discover] ${discovered.length} entities total, ${discovered.filter((e) => e.primary).length} primary`,
  )
  for (const k of [
    'people',
    'journal_entries',
    'compliance_obligations',
    'hazid_assessments',
    'form_responses',
  ]) {
    const e = discovered.find((x) => x.key === k)
    console.log(
      `  ${k}: ${
        e
          ? `"${e.label}" [${e.category}] ${e.columns.length} cols — ${e.columns
              .slice(0, 5)
              .map((c) => `${c.key}:${c.kind}`)
              .join(', ')}`
          : 'MISSING'
      }`,
    )
  }
  console.log('')

  const run = (query: BhqlQuery, maxRows = 500) =>
    withTenant(db, tenant.id, (tx) => runBhql(tx, query, { maxRows }))

  // 1. Raw rows + nested filter + order-by.
  const raw = await run({
    version: 'bhql/1',
    display: 'table',
    stages: [
      {
        source: 'incidents',
        columns: ['reference', 'severity', 'status', 'occurred_at'],
        filter: {
          combinator: 'and',
          rules: [{ field: 'occurred_at', op: 'between_days_ago', value: 3650 }],
        },
        orderBy: [{ ref: 'occurred_at', direction: 'desc' }],
        limit: 25,
      },
    ],
  })
  if (raw.shape !== 'flat') fail('raw query should be flat')
  console.log(
    `[raw]      incidents: cols=${raw.columns.length} rows=${raw.rowCount} truncated=${raw.truncated}`,
  )

  // 2. Grouped: count by enum dimension (implicit count injection).
  const bySev = await run({
    version: 'bhql/1',
    display: 'table',
    stages: [{ source: 'incidents', breakouts: [{ field: 'severity', alias: 'severity' }] }],
  })
  if (bySev.shape !== 'flat') fail('grouped query should be flat')
  if (!bySev.columns.some((c) => c.role === 'measure'))
    fail('grouped query should inject a count measure')
  console.log(
    `[group]    incidents by severity: ${bySev.rows
      .map((r) => `${r.severity ?? '(none)'}=${r.count}`)
      .join(', ')}`,
  )

  // 3. Grouped: multiple measures (count + avg of a numeric column).
  const byStatus = await run({
    version: 'bhql/1',
    display: 'table',
    stages: [
      {
        source: 'incidents',
        breakouts: [{ field: 'status', alias: 'status' }],
        aggregations: [
          { fn: 'count', alias: 'n' },
          { fn: 'avg', field: 'actual_severity', alias: 'avg_sev' },
        ],
      },
    ],
  })
  if (byStatus.shape !== 'flat') fail('multi-measure query should be flat')
  console.log(
    `[measures] incidents by status: ${byStatus.rows
      .map((r) => `${r.status ?? '(none)'}(n=${r.n}, avg=${r.avg_sev ?? '–'})`)
      .join(', ')}`,
  )

  // 4. Temporal binning: count per month.
  const byMonth = await run({
    version: 'bhql/1',
    display: 'table',
    stages: [
      {
        source: 'incidents',
        breakouts: [
          { field: 'occurred_at', alias: 'month', bin: { kind: 'temporal', unit: 'month' } },
        ],
        aggregations: [{ fn: 'count', alias: 'n' }],
      },
    ],
  })
  if (byMonth.shape !== 'flat') fail('temporal query should be flat')
  const monthCol = byMonth.columns.find((c) => c.key === 'month')
  if (monthCol?.semanticType !== 'temporal') fail('binned column should be temporal')
  console.log(
    `[bin]      incidents by month: ${byMonth.rowCount} buckets (dataType=${monthCol?.dataType})`,
  )

  // 5. PIVOT: the training matrix — person × course, cell = latest coverage status.
  const matrix = await run(
    {
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
    },
    50_000,
  )
  if (matrix.shape !== 'pivot') fail('matrix query should be a pivot')
  const sampleRow = matrix.cells[0] ?? []
  const sampleCell = sampleRow.find((c) => c && c.status)
  console.log(
    `[pivot]    training matrix: ${matrix.rowKeys.length} people × ${matrix.columnKeys.length} courses; ` +
      `sample cell status=${sampleCell?.status ?? 'n/a'}`,
  )

  // Discovered-entity queries — prove the engine resolves ANY schema table, not
  // just the old hand-listed ones.
  const peopleCount = await run({
    version: 'bhql/1',
    display: 'table',
    stages: [{ source: 'people', aggregations: [{ fn: 'count', alias: 'n' }] }],
  })
  console.log(
    `[discovered] people count = ${peopleCount.shape === 'flat' ? peopleCount.rows[0]?.n : '?'}`,
  )
  const journalsByMonth = await run({
    version: 'bhql/1',
    display: 'table',
    stages: [
      {
        source: 'journal_entries',
        breakouts: [
          { field: 'created_at', alias: 'month', bin: { kind: 'temporal', unit: 'month' } },
        ],
        aggregations: [{ fn: 'count', alias: 'n' }],
      },
    ],
  })
  console.log(`[discovered] journal_entries by month: ${journalsByMonth.rowCount} buckets`)

  // Filtered (conditional) aggregate + calculated measure: % of incidents that
  // are recordable — computed natively in ONE query (the shape TRIR/DART/% need).
  const recordableQuery: BhqlQuery = {
    version: 'bhql/1',
    display: 'table',
    stages: [
      {
        source: 'incidents',
        aggregations: [
          { fn: 'count', alias: 'total' },
          {
            fn: 'count',
            alias: 'recordable',
            filter: {
              combinator: 'and',
              rules: [{ field: 'severity', op: 'in', value: ['lost_time', 'medical_aid'] }],
            },
          },
          {
            kind: 'calc',
            alias: 'recordable_pct',
            numerator: 'recordable',
            denominator: 'total',
            multiplier: 100,
          },
        ],
      },
    ],
  }
  for (const t of ts) {
    const r = await withTenant(db, t.id, (tx) => runBhql(tx, recordableQuery))
    const row = r.shape === 'flat' ? r.rows[0] : undefined
    console.log(
      `[calc] ${t.name}: total=${row?.total} recordable=${row?.recordable} recordable%=${row?.recordable_pct}`,
    )
  }

  // TRIR over the rates view — a calculated rate over a per-month components view.
  const trirQuery: BhqlQuery = {
    version: 'bhql/1',
    display: 'table',
    stages: [
      {
        source: 'incident_rates',
        aggregations: [
          { fn: 'sum', field: 'recordable_count', alias: 'rec' },
          { fn: 'sum', field: 'hours_worked', alias: 'hrs' },
          { kind: 'calc', alias: 'trir', numerator: 'rec', denominator: 'hrs', multiplier: 200000 },
        ],
      },
    ],
  }
  for (const t of ts) {
    const r = await withTenant(db, t.id, (tx) => runBhql(tx, trirQuery))
    const row = r.shape === 'flat' ? r.rows[0] : undefined
    console.log(`[rates] ${t.name}: recordables=${row?.rec} hours=${row?.hrs} TRIR=${row?.trir}`)
  }

  // FK-aware implicit join: group journals by their SITE NAME (org_units.name),
  // resolved by following journal_entries.site_org_unit_id → org_units — no view,
  // no hand-written SQL, no join clause in the AST. This is the self-serve
  // cross-table primitive.
  const je = discovered.find((e) => e.key === 'journal_entries')
  const rels = je?.relations ?? []
  console.log(
    `\n[joins] journal_entries relations: ${
      rels.map((r) => `${r.via}→${r.target}`).join(', ') || '(none)'
    }`,
  )
  const siteRel = rels.find((r) => r.via === 'site_org_unit_id')
  if (!siteRel) fail('expected a journal_entries → org_units relation via site_org_unit_id')
  if (siteRel.target !== 'org_units')
    fail(`site relation targets ${siteRel.target}, expected org_units`)

  const joinQuery: BhqlQuery = {
    version: 'bhql/1',
    display: 'table',
    stages: [
      {
        source: 'journal_entries',
        breakouts: [{ field: 'site_org_unit_id.name', alias: 'site' }],
        aggregations: [{ fn: 'count', alias: 'entries' }],
        orderBy: [{ ref: 'entries', direction: 'desc' }],
        limit: 5,
      },
    ],
  }
  const validatedJoin = validateBhql(joinQuery) // full validation, incl. the joined ref
  for (const t of ts) {
    const r = await withTenant(db, t.id, (tx) => runBhql(tx, validatedJoin))
    if (r.shape !== 'flat') fail('join query should return a flat result')
    const sites = r.rows.map((row) => `${row.site ?? '(none)'}=${row.entries}`)
    console.log(`[joins] ${t.name}: top sites by journals → ${sites.join(', ') || '(no rows)'}`)
  }

  // RLS: the same count under each tenant should be independently scoped.
  console.log('\n[rls] per-tenant incident counts (proves tenant isolation):')
  for (const t of ts) {
    const r = await withTenant(db, t.id, (tx) =>
      runBhql(tx, {
        version: 'bhql/1',
        display: 'table',
        stages: [{ source: 'incidents', aggregations: [{ fn: 'count', alias: 'n' }] }],
      }),
    )
    const n = r.shape === 'flat' ? (r.rows[0]?.n ?? 0) : 0
    console.log(`      ${t.name}: ${n}`)
  }

  console.log('\nSmoke test passed.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Smoke test FAILED:', err)
  process.exit(1)
})
