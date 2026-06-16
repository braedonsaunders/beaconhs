// Filter → SQL compilation for custom reports. Two stored shapes compile
// through the same leaf compiler:
//
//   v1 — flat ReportCustomFilter[] (implicit AND), written by the original
//        builder and still honoured for existing definitions.
//   v2 — ReportRuleGroup, a nested and/or tree written by the report studio.
//
// Identifiers are never interpolated from user input: column keys must
// resolve through the entity whitelist, and values always bind as
// parameters via drizzle's sql template.

import { sql, type SQL } from 'drizzle-orm'
import type { ReportCustomFilter, ReportRule, ReportRuleGroup } from '@beaconhs/db/schema'
import { entityColumnSql, type ReportEntity } from './entities'

const MAX_TREE_DEPTH = 5
const MAX_TREE_RULES = 60

function isRuleGroup(r: ReportRule | ReportRuleGroup): r is ReportRuleGroup {
  return typeof r === 'object' && r !== null && Array.isArray((r as ReportRuleGroup).rules)
}

/** Each list element as its own bound parameter: `$1, $2, $3`. */
function joinParams(values: (string | number)[]): SQL {
  return sql.join(
    values.map((x) => sql`${x}`),
    sql.raw(', '),
  )
}

/** Default physical ref for a whitelisted column on the entity's own table. */
function defaultColumnSql(entity: ReportEntity, column: string): SQL | null {
  const col = entityColumnSql(entity, column)
  return col ? sql.raw(`"${entity.table}"."${col}"`) : null
}

/** Compile one leaf clause. Returns null when the clause is invalid or a
 *  no-op (unknown column, missing value) — mirroring the v1 executor's
 *  skip-don't-throw behaviour so half-built filters degrade gracefully.
 *
 *  `resolveColumn` lets a caller (the BHQL engine) resolve a field that may
 *  point through a foreign-key relation; when omitted, the column is the
 *  entity's own whitelisted column. */
export function compileRule(
  entity: ReportEntity,
  rule: { column: string; op: string; value?: unknown },
  resolveColumn?: (column: string) => SQL | null,
): SQL | null {
  const colSql = resolveColumn ? resolveColumn(rule.column) : defaultColumnSql(entity, rule.column)
  if (!colSql) return null
  const v = rule.value
  switch (rule.op) {
    case 'eq':
      if (v === null || typeof v === 'undefined' || v === '') return null
      return sql`${colSql} = ${v}`
    case 'neq':
      if (v === null || typeof v === 'undefined' || v === '') return null
      return sql`${colSql} <> ${v}`
    // Per-element bound params (`IN ($1, $2)`) — interpolating the array
    // itself makes drizzle expand it as a row constructor, which `ANY()`
    // rejects (42809). This also fixes the same latent bug the old worker
    // executor had.
    case 'in':
      if (Array.isArray(v) && v.length) {
        return sql.join(
          [sql.raw('('), colSql, sql.raw(' IN ('), joinParams(v), sql.raw('))')],
          sql.raw(''),
        )
      }
      return null
    case 'not_in':
      if (Array.isArray(v) && v.length) {
        return sql.join(
          [sql.raw('('), colSql, sql.raw(' NOT IN ('), joinParams(v), sql.raw('))')],
          sql.raw(''),
        )
      }
      return null
    case 'gte':
      if (v === null || typeof v === 'undefined' || v === '') return null
      return sql`${colSql} >= ${v}`
    case 'lte':
      if (v === null || typeof v === 'undefined' || v === '') return null
      return sql`${colSql} <= ${v}`
    case 'is_null':
      return sql`${colSql} IS NULL`
    case 'is_not_null':
      return sql`${colSql} IS NOT NULL`
    case 'contains':
      return sql`${colSql} ILIKE ${'%' + String(v ?? '') + '%'}`
    case 'between_days_ago': {
      const days = Number(v ?? 30)
      if (!Number.isFinite(days)) return null
      // ISO string, not a Date — raw execute() params bypass drizzle's
      // column-driven encoding and postgres-js rejects Date objects.
      const fromDate = new Date(Date.now() - days * 24 * 3600 * 1000)
      return sql`${colSql} >= ${fromDate.toISOString()}`
    }
    case 'since_today':
      return sql.join([colSql, sql.raw(" >= date_trunc('day', now())")], sql.raw(''))
    case 'this_week':
      return sql.join([colSql, sql.raw(" >= date_trunc('week', now())")], sql.raw(''))
    case 'this_month':
      return sql.join([colSql, sql.raw(" >= date_trunc('month', now())")], sql.raw(''))
    case 'this_year':
      return sql.join([colSql, sql.raw(" >= date_trunc('year', now())")], sql.raw(''))
    case 'before_now':
      return sql.join([colSql, sql.raw(' < now()')], sql.raw(''))
    default:
      return null
  }
}

/** v1: flat filter list, implicit AND. */
export function compileFlatFilters(
  entity: ReportEntity,
  filters: ReportCustomFilter[],
): SQL | null {
  const parts = filters
    .map((f) => compileRule(entity, { column: f.column, op: f.op, value: f.value }))
    .filter((p): p is SQL => p !== null)
  if (!parts.length) return null
  return sql.join(parts, sql.raw(' AND '))
}

/** v2: nested and/or tree. Throws on absurd trees (depth/size caps) since
 *  those only arise from hand-crafted payloads, not the studio UI. */
export function compileRuleGroup(
  entity: ReportEntity,
  group: ReportRuleGroup,
  resolveColumn?: (column: string) => SQL | null,
): SQL | null {
  let ruleCount = 0

  function walk(g: ReportRuleGroup, depth: number): SQL | null {
    if (depth > MAX_TREE_DEPTH) throw new Error('Filter tree too deep')
    const combinator = g.combinator === 'or' ? ' OR ' : ' AND '
    const parts: SQL[] = []
    for (const r of g.rules ?? []) {
      if (++ruleCount > MAX_TREE_RULES) throw new Error('Filter tree too large')
      const compiled = isRuleGroup(r)
        ? walk(r, depth + 1)
        : compileRule(entity, { column: r.field, op: r.op, value: r.value }, resolveColumn)
      if (compiled) parts.push(compiled)
    }
    if (!parts.length) return null
    const joined =
      parts.length === 1
        ? parts[0]!
        : sql.join([sql.raw('('), sql.join(parts, sql.raw(combinator)), sql.raw(')')], sql.raw(''))
    return g.not ? sql.join([sql.raw('NOT ('), joined, sql.raw(')')], sql.raw('')) : joined
  }

  return walk(group, 1)
}

/** Resolve whichever filter shape a stored plan carries into one WHERE SQL. */
export function compileCustomFilters(
  entity: ReportEntity,
  plan: { filters?: ReportCustomFilter[]; filtersV2?: ReportRuleGroup | null },
): SQL | null {
  if (plan.filtersV2 && Array.isArray(plan.filtersV2.rules) && plan.filtersV2.rules.length) {
    return compileRuleGroup(entity, plan.filtersV2)
  }
  if (plan.filters?.length) return compileFlatFilters(entity, plan.filters)
  return null
}
