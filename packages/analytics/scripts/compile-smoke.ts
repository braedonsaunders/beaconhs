// Offline compile smoke — proves the multi-source compiler emits valid SQL
// without touching the DB. Run: pnpm exec tsx packages/analytics/scripts/compile-smoke.ts
import { PgDialect } from 'drizzle-orm/pg-core'
import type { BhqlQuery } from '@beaconhs/db/schema'
import { compileBhql } from '../src/server/compile'
import { discoverEntityMap } from '../src/server/discover'
import { parseBhqlQuery } from '../src/ast-schema'

const entityMap = discoverEntityMap()
const dialect = new PgDialect()
const show = (label: string, q: BhqlQuery) => {
  const parsed = parseBhqlQuery(q, entityMap)
  const compiled = compileBhql(parsed, { entityMap })
  console.log(`\n=== ${label} ===`)
  console.log(dialect.sqlToQuery(compiled.sql).sql)
  console.log('columns:', compiled.columns.map((c) => `${c.key}:${c.dataType}`).join(', '))
}

// 1) TRIR by month — recordables (incidents) ÷ hours (incident_hours_periods) × 200000
show('TRIR by month (cross-source)', {
  version: 'bhql/1',
  display: 'table',
  pivot: null,
  stages: [
    {
      source: 'incidents',
      breakouts: [
        { field: 'occurred_at', alias: 'month', bin: { kind: 'temporal', unit: 'month' } },
      ],
      aggregations: [
        {
          fn: 'count',
          alias: 'recordable',
          filter: { combinator: 'and', rules: [{ field: 'severity', op: 'eq', value: 'lost_time' }] },
        },
        { kind: 'calc', alias: 'trir', numerator: 'recordable', denominator: 'hours', multiplier: 200000 },
      ],
      joinedSources: [
        {
          source: 'incident_hours_periods',
          measures: [{ fn: 'sum', field: 'total_hours', alias: 'hours' }],
          on: [{ breakout: 'month', field: 'period_start', bin: { kind: 'temporal', unit: 'month' } }],
        },
      ],
    },
  ],
})

// 1b) Numeric histogram — equal-width buckets over a numeric column
show('Numeric binning (histogram)', {
  version: 'bhql/1',
  display: 'table',
  pivot: null,
  stages: [
    {
      source: 'incident_hours_periods',
      breakouts: [
        { field: 'total_hours', alias: 'hours_bucket', bin: { kind: 'numeric', numBins: 10 } },
      ],
      aggregations: [{ fn: 'count', alias: 'periods' }],
    },
  ],
})

// 1c) Tag analytics — unnest a jsonb array column, group by element
show('Top journal tags (jsonb unnest)', {
  version: 'bhql/1',
  display: 'table',
  pivot: null,
  stages: [
    {
      source: 'journal_entries',
      breakouts: [{ field: 'tags_cache', alias: 'tag', unnest: 'jsonb' }],
      aggregations: [{ fn: 'count', alias: 'entries' }],
      orderBy: [{ ref: 'entries', direction: 'desc' }],
      limit: 20,
    },
  ],
})

// 2) Org-wide scalar TRIR (no grain → CROSS JOIN of two single-row aggregates)
show('TRIR scalar (no grain)', {
  version: 'bhql/1',
  display: 'table',
  pivot: null,
  stages: [
    {
      source: 'incidents',
      aggregations: [
        { fn: 'count', alias: 'recordable' },
        { kind: 'calc', alias: 'trir', numerator: 'recordable', denominator: 'hours', multiplier: 200000 },
      ],
      joinedSources: [
        {
          source: 'incident_hours_periods',
          measures: [{ fn: 'sum', field: 'total_hours', alias: 'hours' }],
          on: [],
        },
      ],
    },
  ],
})

// 3) Training matrix — view-free rebuild of report_training_matrix (people ×
//    courses ⟕ latest training record → coverage status). Must match the view.
const cd = { ex: 'call', fn: 'current_date', args: [] } as const
show('Training matrix (spine, view-free)', {
  version: 'bhql/1',
  display: 'pivot',
  pivot: {
    rows: [{ breakout: 'person_name' }],
    columns: [{ breakout: 'course_name' }],
    values: [{ measure: 'coverage_status' }],
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
          alias: 'person_name',
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
        { alias: 'course_name', field: 'c.name' },
      ],
      aggregations: [
        {
          kind: 'expr',
          alias: 'coverage_status',
          expr: {
            ex: 'agg',
            fn: 'min',
            arg: {
              ex: 'case',
              branches: [
                { when: { ex: 'isnull', arg: { ex: 'field', field: 'tr.id' } }, then: { ex: 'lit', value: 'missing' } },
                { when: { ex: 'isnull', arg: { ex: 'field', field: 'tr.expires_on' } }, then: { ex: 'lit', value: 'valid' } },
                { when: { ex: 'compare', op: '<', left: { ex: 'field', field: 'tr.expires_on' }, right: cd }, then: { ex: 'lit', value: 'expired' } },
                { when: { ex: 'compare', op: '<=', left: { ex: 'field', field: 'tr.expires_on' }, right: { ex: 'arith', op: '+', left: cd, right: { ex: 'lit', value: 90 } } }, then: { ex: 'lit', value: 'expiring' } },
              ],
              else: { ex: 'lit', value: 'valid' },
            },
          },
        },
      ],
      orderBy: [
        { ref: 'person_name', direction: 'asc' },
        { ref: 'course_name', direction: 'asc' },
      ],
    },
  ],
})
