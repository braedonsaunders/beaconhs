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

import { getEntityAttrDef } from './entity-attrs'
import type { DefaultValueExpression, FormulaExpression, LogicRule } from './schema'

export type FieldValueMap = Record<string, unknown>

/** Per-row map keyed by section id → array of row value maps. */
export type RowMap = Record<string, Array<FieldValueMap>>

/**
 * Map of picker field id → attribute map fetched from the picked entity.
 *
 * Keyed by the *picker field key* (not the entity id) so the runtime can
 * prefetch one row per picker and let the evaluator look up attrs without
 * needing to know what id the picker resolved to. `null` means the picker
 * has no selection (or the entity wasn't found / RLS-blocked).
 */
export type EntityAttrsByField = Record<string, Record<string, unknown> | null>

/**
 * Evaluation context shared by logic + formula evaluators.
 *
 * `values`   — flat top-level field values (non-repeating sections).
 * `rows`     — per-section repeating-row arrays. `rows[sectionId][rowIndex][fieldKey]`.
 * `entities` — allowlisted attribute maps for each picker field's selection,
 *              loaded server-side and refreshed on picker change. Read by the
 *              `entity_attr` formula operator.
 * `requestContext` — used by `resolveDefaultValue` to produce `today`, `now`,
 *                    `current_user_*` defaults.
 */
export type EvalContext = {
  values: FieldValueMap
  rows: RowMap
  entities?: EntityAttrsByField
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
 * Coerce a raw entity attribute value to match its declared EntityAttrDef
 * valueType. We're intentionally permissive — null falls through unchanged
 * so callers can render their own "—" fallback. Date columns may arrive as
 * either a JS Date (from drizzle ORM) or an ISO string (from a JSON
 * round-trip), so we normalise them to ISO strings either way.
 */
function coerceEntityAttr(
  raw: unknown,
  valueType: 'string' | 'number' | 'date' | 'boolean',
): string | number | boolean | null {
  if (raw === undefined || raw === null) return null
  switch (valueType) {
    case 'string':
      return String(raw)
    case 'number': {
      const n = Number(raw)
      return Number.isFinite(n) ? n : null
    }
    case 'boolean':
      return Boolean(raw)
    case 'date': {
      if (raw instanceof Date) {
        return Number.isNaN(raw.getTime()) ? null : raw.toISOString()
      }
      if (typeof raw === 'string') return raw
      return null
    }
  }
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
      return expr.of.reduce<number>((acc, e) => acc + coerceNumber(evaluateFormulaTree(e, ctx)), 0)

    case 'product':
      return expr.of.reduce<number>((acc, e) => acc * coerceNumber(evaluateFormulaTree(e, ctx)), 1)

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

    case 'power': {
      const r = Math.pow(
        coerceNumber(evaluateFormulaTree(expr.base, ctx)),
        coerceNumber(evaluateFormulaTree(expr.exponent, ctx)),
      )
      return Number.isFinite(r) ? r : 0
    }

    case 'root': {
      const b = coerceNumber(evaluateFormulaTree(expr.of, ctx))
      const d = coerceNumber(evaluateFormulaTree(expr.degree, ctx))
      if (d === 0) return 0
      // Preserve sign so odd roots of negatives work (e.g. cube root of −8 = −2)
      // and even roots of negatives don't produce NaN.
      const r = Math.sign(b) * Math.pow(Math.abs(b), 1 / d)
      return Number.isFinite(r) ? r : 0
    }

    case 'abs':
      return Math.abs(coerceNumber(evaluateFormulaTree(expr.of, ctx)))

    case 'round': {
      const places = Number.isFinite(expr.places) ? (expr.places as number) : 0
      const factor = Math.pow(10, places)
      return Math.round(coerceNumber(evaluateFormulaTree(expr.of, ctx)) * factor) / factor
    }

    case 'floor':
      return Math.floor(coerceNumber(evaluateFormulaTree(expr.of, ctx)))

    case 'ceil':
      return Math.ceil(coerceNumber(evaluateFormulaTree(expr.of, ctx)))

    case 'sum_section': {
      const rows = ctx.rows[expr.sectionKey] ?? []
      return rows.reduce<number>((acc, row) => acc + coerceNumber(row[expr.rowFieldKey]), 0)
    }

    case 'count_section':
      return (ctx.rows[expr.sectionKey] ?? []).length

    case 'avg_section': {
      const rows = ctx.rows[expr.sectionKey] ?? []
      if (rows.length === 0) return null
      const sum = rows.reduce<number>((acc, row) => acc + coerceNumber(row[expr.rowFieldKey]), 0)
      return sum / rows.length
    }

    case 'min_section': {
      const nums = (ctx.rows[expr.sectionKey] ?? []).map((row) =>
        coerceNumber(row[expr.rowFieldKey]),
      )
      return nums.length === 0 ? null : Math.min(...nums)
    }

    case 'max_section': {
      const nums = (ctx.rows[expr.sectionKey] ?? []).map((row) =>
        coerceNumber(row[expr.rowFieldKey]),
      )
      return nums.length === 0 ? null : Math.max(...nums)
    }

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

    case 'entity_attr': {
      // Read an attribute off the entity bound to a picker field. The runtime
      // prefetches the row server-side and stashes it on ctx.entities keyed
      // by the picker field id, so we just look it up here.
      //
      // The loader stamps a sidecar `__entityKind` (e.g. 'person', 'equipment')
      // on each entity map. We use it to resolve the EntityAttrDef from the
      // registry and coerce accordingly. Attrs not in ENTITY_ATTRS never made
      // it onto the row (the loader allowlists at SELECT-time), so this lookup
      // doubles as the runtime allowlist check.
      const entities = ctx.entities
      if (!entities) return null
      const entity = entities[expr.pickerFieldKey]
      if (!entity) return null
      const raw = entity[expr.attrKey]
      if (raw === undefined) return null
      const kindHint = (entity as { __entityKind?: string }).__entityKind
      if (kindHint) {
        const def = getEntityAttrDef(
          kindHint as Parameters<typeof getEntityAttrDef>[0],
          expr.attrKey,
        )
        if (def) {
          const coerced = coerceEntityAttr(raw, def.valueType)
          // Booleans don't fit the formula return type. Coerce to number
          // (0/1) so they compose with sum/product downstream — designers
          // can `if(entity_attr=1)` etc.
          if (typeof coerced === 'boolean') return coerced ? 1 : 0
          return coerced
        }
      }
      // Fallthrough: kindHint missing — accept primitive scalars, stringify
      // Dates. We never return non-primitive shapes (objects / arrays).
      if (raw instanceof Date) {
        return Number.isNaN(raw.getTime()) ? null : raw.toISOString()
      }
      if (typeof raw === 'boolean') return raw ? 1 : 0
      if (typeof raw === 'string' || typeof raw === 'number') return raw
      return null
    }
  }
}

// --- Default-value resolver ------------------------------------------------

/**
 * Resolve a DefaultValueExpression to a concrete value for the first render
 * of a field. Returns `undefined` if no default applies (e.g. expression
 * evaluates to null).
 */
export function resolveDefaultValue(expr: DefaultValueExpression, ctx: EvalContext): unknown {
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
