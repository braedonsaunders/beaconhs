// Seed the "Training matrix" as a published Insights pivot Card — the generic
// abstraction of the hand-built /training/matrix page. Idempotent (upserts by
// name). Also runs the stored card to prove it compiles + renders.
//
//   pnpm --filter @beaconhs/worker exec tsx --env-file=../../.env src/scripts/seed-insights-matrix.ts

import { and, eq, isNull } from 'drizzle-orm'
import { runBhql, validateBhql } from '@beaconhs/analytics/server'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import { insightCards, tenants, type BhqlExpr, type BhqlQuery } from '@beaconhs/db/schema'

const CARD_NAME = 'Training matrix'

// View-free: a SPINE over the raw tables (people × training_courses ⟕ latest
// training_record) reproducing report_training_matrix exactly — same person ×
// course grid, same latest-record-per-cell, same missing/valid/expired/expiring
// coverage CASE (CURRENT_DATE + 90). Renders identically (vizType pivot, the
// string `status` measure auto-colours RAG via the renderer's default).
const CD: BhqlExpr = { ex: 'call', fn: 'current_date', args: [] }
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
      source: 'people',
      spine: {
        dimensions: [
          {
            alias: 'p',
            source: 'people',
            filter: {
              combinator: 'and',
              rules: [
                { field: 'status', op: 'eq', value: 'active' },
                { field: 'deleted_at', op: 'is_null' },
              ],
            },
          },
          {
            alias: 'c',
            source: 'training_courses',
            filter: { combinator: 'and', rules: [{ field: 'deleted_at', op: 'is_null' }] },
          },
        ],
        facts: [
          {
            alias: 'tr',
            source: 'training_records',
            on: [
              { field: 'person_id', equals: 'p.id' },
              { field: 'course_id', equals: 'c.id' },
            ],
            filter: { combinator: 'and', rules: [{ field: 'deleted_at', op: 'is_null' }] },
            latestBy: [{ ref: 'completed_on', direction: 'desc' }],
          },
        ],
      },
      breakouts: [
        {
          alias: 'person',
          expr: {
            ex: 'call',
            fn: 'concat',
            args: [
              { ex: 'field', field: 'p.last_name' },
              { ex: 'lit', value: ', ' },
              { ex: 'field', field: 'p.first_name' },
            ],
          },
        },
        { alias: 'course', field: 'c.code' },
      ],
      aggregations: [
        {
          kind: 'expr',
          alias: 'status',
          expr: {
            ex: 'agg',
            fn: 'min',
            arg: {
              ex: 'case',
              branches: [
                { when: { ex: 'isnull', arg: { ex: 'field', field: 'tr.id' } }, then: { ex: 'lit', value: 'missing' } },
                { when: { ex: 'isnull', arg: { ex: 'field', field: 'tr.expires_on' } }, then: { ex: 'lit', value: 'valid' } },
                { when: { ex: 'compare', op: '<', left: { ex: 'field', field: 'tr.expires_on' }, right: CD }, then: { ex: 'lit', value: 'expired' } },
                { when: { ex: 'compare', op: '<=', left: { ex: 'field', field: 'tr.expires_on' }, right: { ex: 'arith', op: '+', left: CD, right: { ex: 'lit', value: 90 } } }, then: { ex: 'lit', value: 'expiring' } },
              ],
              else: { ex: 'lit', value: 'valid' },
            },
          },
        },
      ],
      orderBy: [
        { ref: 'person', direction: 'asc' },
        { ref: 'course', direction: 'asc' },
      ],
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
