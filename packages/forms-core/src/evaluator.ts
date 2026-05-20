// Typed JSON-tree evaluators for form field logic and formulas.
//
// Sits alongside the older string-based `evaluateFormula(expr, values)` (which
// targets `field.config.expr` strings) and the rule-based `evalLogicRule()`
// (which already exists for flat `values` maps).
//
// What this module adds:
//   - `evaluateLogicRule(rule, ctx)` — same semantics as `evalLogicRule` but
//     accepts the richer EvalContext so visibility rules can reference fields
//     inside repeating sections via `<sectionKey>.<fieldKey>`.
//   - `evaluateFormulaTree(expr, ctx)` — walks a typed FormulaExpression tree.
//     Designer-built calc fields store this on `field.formula`.
//   - `resolveDefaultValue(expr, ctx)` — produces an initial value for a field
//     from a typed DefaultValueExpression.
//
// All evaluators are pure functions: no React, no DB. Bugs here corrupt every
// response so the unit tests in `./evaluator.test.ts` exercise every operator.

import type { DefaultValueExpression, FormulaExpression, LogicRule } from './schema'

export type FieldValueMap = Record<string, unknown>

/** Per-row map keyed by section id → array of row value maps. */
export type RowMap = Record<string, Array<FieldValueMap>>

/**
 * Evaluation context shared by logic + formula evaluators.
 *
 * `values` — flat top-level field values (non-repeating sections).
 * `rows`   — per-section repeating-row arrays. `rows[sectionId][rowIndex][fieldKey]`.
 * `requestContext` — used by `resolveDefaultValue` to produce `today`, `now`,
 *                    `current_user_*` defaults.
 */
export type EvalContext = {
  values: FieldValueMap
  rows: RowMap
  requestContext?: {
    now?: Date
    currentUserPersonId?: string | null
    currentUserName?: string | null
  }
}

// --- Helpers ---------------------------------------------------------------

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (typeof v === 'string' && v.trim() === '') return true
  if (Array.isArray(v) && v.length === 0) return true
  return false
}

function coerceNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Resolve a field reference of the form `<fieldKey>` (top-level) or
 * `<sectionKey>.<fieldKey>` (returns null for repeating refs because we'd
 * need a row index — use `sum_section` / `count_section` for those).
 */
function resolveFieldRef(ctx: EvalContext, key: string): unknown {
  if (key.includes('.')) {
    // Repeating-row reference. We surface row data via sum_section etc. so
    // direct dotted refs in logic/formula return undefined intentionally —
    // the caller should split sections out into top-level fields or use the
    // section-aware operators.
    return undefined
  }
  return ctx.values[key]
}

// --- Logic evaluator -------------------------------------------------------

/**
 * Evaluate a LogicRule against the given values/rows context.
 * Returns true if the rule is satisfied. An undefined rule is treated as
 * "always true" by the caller, not here — pass-through is up to the renderer.
 */
export function evaluateLogicRule(rule: LogicRule, ctx: EvalContext): boolean {
  switch (rule.op) {
    case 'and':
      return rule.rules.every((r) => evaluateLogicRule(r, ctx))
    case 'or':
      return rule.rules.some((r) => evaluateLogicRule(r, ctx))
    case 'not':
      return !evaluateLogicRule(rule.rule, ctx)
    case 'eq':
      return resolveFieldRef(ctx, rule.field) === rule.value
    case 'ne':
      return resolveFieldRef(ctx, rule.field) !== rule.value
    case 'gt':
      return coerceNumber(resolveFieldRef(ctx, rule.field)) > coerceNumber(rule.value)
    case 'lt':
      return coerceNumber(resolveFieldRef(ctx, rule.field)) < coerceNumber(rule.value)
    case 'gte':
      return coerceNumber(resolveFieldRef(ctx, rule.field)) >= coerceNumber(rule.value)
    case 'lte':
      return coerceNumber(resolveFieldRef(ctx, rule.field)) <= coerceNumber(rule.value)
    case 'in': {
      const v = resolveFieldRef(ctx, rule.field)
      // Multi-select / checkbox_group store arrays — treat as "any overlap".
      if (Array.isArray(v)) return v.some((x) => rule.value.includes(x))
      return rule.value.includes(v)
    }
    case 'notIn': {
      const v = resolveFieldRef(ctx, rule.field)
      if (Array.isArray(v)) return !v.some((x) => rule.value.includes(x))
      return !rule.value.includes(v)
    }
    case 'isSet':
      return !isEmpty(resolveFieldRef(ctx, rule.field))
    case 'isNotSet':
      return isEmpty(resolveFieldRef(ctx, rule.field))
  }
}

// --- Formula evaluator -----------------------------------------------------

/**
 * Evaluate a FormulaExpression tree. Returns `number | string | null`.
 *
 * - Pure arithmetic operators coerce inputs to numbers (missing → 0).
 * - `concat` produces a string.
 * - `if` returns whichever branch matches the condition.
 * - `sum_section` / `count_section` walk `ctx.rows[sectionKey]`.
 */
export function evaluateFormulaTree(
  expr: FormulaExpression,
  ctx: EvalContext,
): number | string | null {
  switch (expr.kind) {
    case 'literal':
      return expr.value

    case 'field_ref': {
      const v = resolveFieldRef(ctx, expr.fieldKey)
      if (v === undefined || v === null) return null
      // String values stay as strings; numeric strings coerce automatically
      // when the caller composes them through `sum` etc.
      return typeof v === 'number' ? v : typeof v === 'string' ? v : (coerceNumber(v) as number)
    }

    case 'sum':
      return expr.of.reduce<number>(
        (acc, e) => acc + coerceNumber(evaluateFormulaTree(e, ctx)),
        0,
      )

    case 'product':
      return expr.of.reduce<number>(
        (acc, e) => acc * coerceNumber(evaluateFormulaTree(e, ctx)),
        1,
      )

    case 'subtract':
      return (
        coerceNumber(evaluateFormulaTree(expr.left, ctx)) -
        coerceNumber(evaluateFormulaTree(expr.right, ctx))
      )

    case 'divide': {
      const r = coerceNumber(evaluateFormulaTree(expr.right, ctx))
      // Divide-by-zero short-circuits to 0 so chained formulas don't NaN.
      return r === 0 ? 0 : coerceNumber(evaluateFormulaTree(expr.left, ctx)) / r
    }

    case 'min': {
      if (expr.of.length === 0) return 0
      return Math.min(...expr.of.map((e) => coerceNumber(evaluateFormulaTree(e, ctx))))
    }

    case 'max': {
      if (expr.of.length === 0) return 0
      return Math.max(...expr.of.map((e) => coerceNumber(evaluateFormulaTree(e, ctx))))
    }

    case 'sum_section': {
      const rows = ctx.rows[expr.sectionKey] ?? []
      return rows.reduce<number>((acc, row) => acc + coerceNumber(row[expr.rowFieldKey]), 0)
    }

    case 'count_section':
      return (ctx.rows[expr.sectionKey] ?? []).length

    case 'concat': {
      const sep = expr.separator ?? ''
      return expr.of
        .map((e) => {
          const v = evaluateFormulaTree(e, ctx)
          if (v === null || v === undefined) return ''
          return String(v)
        })
        .join(sep)
    }

    case 'if':
      return evaluateLogicRule(expr.condition, ctx)
        ? evaluateFormulaTree(expr.then, ctx)
        : evaluateFormulaTree(expr.else, ctx)
  }
}

// --- Default-value resolver ------------------------------------------------

/**
 * Resolve a DefaultValueExpression to a concrete value for the first render
 * of a field. Returns `undefined` if no default applies (e.g. expression
 * evaluates to null).
 */
export function resolveDefaultValue(
  expr: DefaultValueExpression,
  ctx: EvalContext,
): unknown {
  const now = ctx.requestContext?.now ?? new Date()
  switch (expr.kind) {
    case 'literal':
      return expr.value
    case 'today':
      // ISO yyyy-mm-dd format expected by <input type="date">.
      return now.toISOString().slice(0, 10)
    case 'now':
      // ISO yyyy-mm-ddThh:mm format expected by <input type="datetime-local">.
      return now.toISOString().slice(0, 16)
    case 'current_user_person_id':
      return ctx.requestContext?.currentUserPersonId ?? null
    case 'current_user_name':
      return ctx.requestContext?.currentUserName ?? null
    case 'expression': {
      const v = evaluateFormulaTree(expr.expr, ctx)
      return v ?? undefined
    }
  }
}
