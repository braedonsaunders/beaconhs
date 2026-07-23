// Drizzle adapter for the BHQL compiler. Report definitions themselves use the
// AppKit SQL compiler; BHQL still emits Drizzle SQL because it composes joins,
// metrics, and pivots before execution.
import { sql, type SQL } from 'drizzle-orm'
import type { ReportRule, ReportRuleGroup } from '@beaconhs/db/schema'
import { columnRef, type ReportEntity } from '@beaconhs/reports/entities'

const MAX_TREE_DEPTH = 5
const MAX_TREE_RULES = 60

function isRuleGroup(rule: ReportRule | ReportRuleGroup): rule is ReportRuleGroup {
  return typeof rule === 'object' && rule !== null && Array.isArray((rule as ReportRuleGroup).rules)
}

function joinParams(values: (string | number)[]): SQL {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql.raw(', '),
  )
}

function currentPeriodClause(column: SQL, unit: 'day' | 'week' | 'month' | 'year'): SQL {
  return sql.join(
    [
      sql.raw('('),
      column,
      sql.raw(` >= date_trunc('${unit}', now()) AND `),
      column,
      sql.raw(` < date_trunc('${unit}', now()) + interval '1 ${unit}')`),
    ],
    sql.raw(''),
  )
}

function compileRule(
  entity: ReportEntity,
  rule: { column: string; op: string; value?: unknown },
  resolveColumn?: (column: string) => SQL | null,
): SQL | null {
  const reference = resolveColumn
    ? resolveColumn(rule.column)
    : (() => {
        const value = columnRef(entity, rule.column)
        return value ? sql.raw(value) : null
      })()
  if (!reference) return null
  const value = rule.value
  switch (rule.op) {
    case 'eq':
      return value == null || value === '' ? null : sql`${reference} = ${value}`
    case 'neq':
      return value == null || value === '' ? null : sql`${reference} <> ${value}`
    case 'in':
      return Array.isArray(value) && value.length
        ? sql.join(
            [sql.raw('('), reference, sql.raw(' IN ('), joinParams(value), sql.raw('))')],
            sql.raw(''),
          )
        : null
    case 'not_in':
      return Array.isArray(value) && value.length
        ? sql.join(
            [sql.raw('('), reference, sql.raw(' NOT IN ('), joinParams(value), sql.raw('))')],
            sql.raw(''),
          )
        : null
    case 'gte':
      return value == null || value === '' ? null : sql`${reference} >= ${value}`
    case 'lte':
      return value == null || value === '' ? null : sql`${reference} <= ${value}`
    case 'is_null':
      return sql`${reference} IS NULL`
    case 'is_not_null':
      return sql`${reference} IS NOT NULL`
    case 'is_true':
      return sql.join([reference, sql.raw(' IS TRUE')], sql.raw(''))
    case 'is_false':
      return sql.join([reference, sql.raw(' IS FALSE')], sql.raw(''))
    case 'contains':
      return value == null || value === '' ? null : sql`${reference} ILIKE ${`%${String(value)}%`}`
    case 'between_days_ago': {
      const days = Number(value ?? 30)
      return Number.isFinite(days)
        ? sql`${reference} >= ${new Date(Date.now() - days * 86_400_000).toISOString()}`
        : null
    }
    case 'due_within_days': {
      const days = Number(value ?? 30)
      return Number.isFinite(days)
        ? sql`${reference} <= ${new Date(Date.now() + days * 86_400_000).toISOString()}`
        : null
    }
    case 'since_today':
      return currentPeriodClause(reference, 'day')
    case 'this_week':
      return currentPeriodClause(reference, 'week')
    case 'this_month':
      return currentPeriodClause(reference, 'month')
    case 'this_year':
      return currentPeriodClause(reference, 'year')
    case 'before_now':
      return sql.join([reference, sql.raw(' < now()')], sql.raw(''))
    default:
      return null
  }
}

export function compileRuleGroup(
  entity: ReportEntity,
  group: ReportRuleGroup,
  resolveColumn?: (column: string) => SQL | null,
): SQL | null {
  let count = 0
  const walk = (current: ReportRuleGroup, depth: number): SQL | null => {
    if (depth > MAX_TREE_DEPTH) throw new Error('Filter tree too deep')
    const parts: SQL[] = []
    for (const rule of current.rules) {
      if (++count > MAX_TREE_RULES) throw new Error('Filter tree too large')
      const compiled = isRuleGroup(rule)
        ? walk(rule, depth + 1)
        : compileRule(entity, { column: rule.field, op: rule.op, value: rule.value }, resolveColumn)
      if (compiled) parts.push(compiled)
    }
    if (!parts.length) return null
    const joined =
      parts.length === 1
        ? parts[0]!
        : sql.join(
            [
              sql.raw('('),
              sql.join(parts, sql.raw(current.combinator === 'or' ? ' OR ' : ' AND ')),
              sql.raw(')'),
            ],
            sql.raw(''),
          )
    return current.not ? sql.join([sql.raw('NOT ('), joined, sql.raw(')')], sql.raw('')) : joined
  }
  return walk(group, 1)
}
