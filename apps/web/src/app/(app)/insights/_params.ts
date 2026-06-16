// Dashboard-level parameters (filters) that fan out into the cards on a
// dashboard. A dashboard owns a list of `DashboardParam`s (key/label/type/
// default) and a `paramMap` that points each param at one or more (card, field)
// targets. At run time the chosen value is appended to the target card's BHQL
// filter as an AND-ed `ReportRule`, so a single "Site" control can scope every
// mapped card at once.
//
// Pure + isomorphic: imports only TYPES from @beaconhs/db/schema (no drizzle, no
// 'use server'/'use client'), so the URL helpers are safe to import from the
// client filter bar while `applyParams` is only ever called server-side, just
// before each card is compiled.

import type {
  BhqlQuery,
  DashboardParam,
  DashboardParamMap,
  ReportRule,
  ReportRuleGroup,
} from '@beaconhs/db/schema'

/** URL namespace for param values — keeps them clear of reserved query keys. */
const PARAM_PREFIX = 'p_'

/** The search-param key a dashboard param's value travels under in the URL. */
export function paramSearchKey(key: string): string {
  return `${PARAM_PREFIX}${key}`
}

/** A scalar value is "set" once it is neither null/undefined nor an empty string. */
function isSet(v: unknown): boolean {
  return v !== null && typeof v !== 'undefined' && v !== ''
}

/** Coerce one raw value (from the URL or a stored default) to the JS type the
 *  param's `type` implies, so the eventual filter binds correctly (e.g. an
 *  integer column rejects a text-bound parameter). Returns `undefined` when the
 *  value can't be made sense of (dropped → param treated as unset). */
function coerce(raw: unknown, type: DashboardParam['type']): string | number | undefined {
  if (Array.isArray(raw)) {
    // URL repeats / multi-select — collapse to the first set value for now.
    const first = raw.find(isSet)
    return typeof first === 'undefined' ? undefined : coerce(first, type)
  }
  if (!isSet(raw)) return undefined
  if (type === 'number') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  }
  return String(raw)
}

/** Resolve the effective value of each dashboard param from a flat URL
 *  search-param map, falling back to the param's stored default. Only params
 *  with a set value appear in the result — unset params don't filter anything. */
export function resolveParamValues(
  params: DashboardParam[],
  urlValues: Record<string, string | string[] | undefined>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const p of params) {
    const fromUrl = urlValues[paramSearchKey(p.key)]
    const raw = isSet(fromUrl) || Array.isArray(fromUrl) ? fromUrl : p.defaultValue
    const value = coerce(raw, p.type)
    if (typeof value !== 'undefined') out[p.key] = value
  }
  return out
}

/** Build the filter clause one param value contributes to a card. Arrays use
 *  `in`; scalars use `eq`. The field is whitelisted again by the compiler. */
function ruleFor(field: string, value: unknown): ReportRule | null {
  if (Array.isArray(value)) {
    const vals = value.filter(isSet) as (string | number)[]
    if (!vals.length) return null
    const allNum = vals.every((v) => typeof v === 'number')
    return { field, op: 'in', value: allNum ? (vals as number[]) : vals.map(String) }
  }
  if (!isSet(value)) return null
  return { field, op: 'eq', value: value as string | number }
}

/** Pure. Append an AND-ed `ReportRule` to the card's first stage filter for each
 *  (param → {cardId, field}) mapping that targets THIS card and has a set value.
 *  Returns the query unchanged when nothing applies. The appended rules are
 *  always AND-ed against the card's own filter, even when that filter is an OR
 *  group, so a parameter can only ever narrow a card — never widen it. */
export function applyParams(
  query: BhqlQuery,
  paramValues: Record<string, unknown>,
  paramMap: DashboardParamMap,
  cardId: string,
): BhqlQuery {
  const stage = query.stages[0]
  if (!stage) return query

  const rules: ReportRule[] = []
  for (const [paramKey, targets] of Object.entries(paramMap ?? {})) {
    const value = paramValues[paramKey]
    if (!isSet(value) && !Array.isArray(value)) continue
    for (const t of targets) {
      if (t.cardId !== cardId) continue
      const rule = ruleFor(t.field, value)
      if (rule) rules.push(rule)
    }
  }
  if (rules.length === 0) return query

  const existing = stage.filter
  let filter: ReportRuleGroup
  if (!existing || !existing.rules?.length) {
    filter = { combinator: 'and', rules }
  } else if (existing.combinator === 'and' && !existing.not) {
    // The card's own filter is already a top-level AND — just extend it.
    filter = { ...existing, rules: [...existing.rules, ...rules] }
  } else {
    // OR / negated group: wrap it so the params still narrow (AND) the result.
    filter = { combinator: 'and', rules: [existing, ...rules] }
  }

  return { ...query, stages: [{ ...stage, filter }, ...query.stages.slice(1)] }
}
