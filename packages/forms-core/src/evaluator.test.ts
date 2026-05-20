import { describe, expect, it } from 'vitest'
import {
  evaluateFormulaTree,
  evaluateLogicRule,
  resolveDefaultValue,
  type EvalContext,
} from './evaluator'
import type { FormulaExpression, LogicRule } from './schema'

function makeCtx(overrides: Partial<EvalContext> = {}): EvalContext {
  return {
    values: {},
    rows: {},
    ...overrides,
  }
}

// =========================================================================
// Logic evaluator
// =========================================================================

describe('evaluateLogicRule', () => {
  describe('comparators', () => {
    it('eq + ne return based on value equality', () => {
      const ctx = makeCtx({ values: { color: 'red' } })
      expect(evaluateLogicRule({ op: 'eq', field: 'color', value: 'red' }, ctx)).toBe(true)
      expect(evaluateLogicRule({ op: 'eq', field: 'color', value: 'blue' }, ctx)).toBe(false)
      expect(evaluateLogicRule({ op: 'ne', field: 'color', value: 'blue' }, ctx)).toBe(true)
    })

    it('gt / lt / gte / lte coerce both sides to numbers', () => {
      const ctx = makeCtx({ values: { count: '5' } })
      expect(evaluateLogicRule({ op: 'gt', field: 'count', value: 3 }, ctx)).toBe(true)
      expect(evaluateLogicRule({ op: 'lt', field: 'count', value: 3 }, ctx)).toBe(false)
      expect(evaluateLogicRule({ op: 'gte', field: 'count', value: 5 }, ctx)).toBe(true)
      expect(evaluateLogicRule({ op: 'lte', field: 'count', value: 4 }, ctx)).toBe(false)
    })

    it('in / notIn handle scalar AND array field values', () => {
      const ctxScalar = makeCtx({ values: { tier: 'gold' } })
      expect(
        evaluateLogicRule(
          { op: 'in', field: 'tier', value: ['silver', 'gold'] },
          ctxScalar,
        ),
      ).toBe(true)
      expect(
        evaluateLogicRule(
          { op: 'notIn', field: 'tier', value: ['silver'] },
          ctxScalar,
        ),
      ).toBe(true)

      const ctxArray = makeCtx({ values: { ppe: ['hard_hat', 'gloves'] } })
      expect(
        evaluateLogicRule(
          { op: 'in', field: 'ppe', value: ['gloves'] },
          ctxArray,
        ),
      ).toBe(true)
      expect(
        evaluateLogicRule(
          { op: 'notIn', field: 'ppe', value: ['gloves'] },
          ctxArray,
        ),
      ).toBe(false)
    })

    it('isSet / isNotSet treat undefined, null, empty-string, empty-array as empty', () => {
      const ctx = makeCtx({
        values: { a: 'x', b: '', c: null, d: undefined, e: [] },
      })
      expect(evaluateLogicRule({ op: 'isSet', field: 'a' }, ctx)).toBe(true)
      expect(evaluateLogicRule({ op: 'isSet', field: 'b' }, ctx)).toBe(false)
      expect(evaluateLogicRule({ op: 'isSet', field: 'c' }, ctx)).toBe(false)
      expect(evaluateLogicRule({ op: 'isSet', field: 'd' }, ctx)).toBe(false)
      expect(evaluateLogicRule({ op: 'isSet', field: 'e' }, ctx)).toBe(false)
      expect(evaluateLogicRule({ op: 'isNotSet', field: 'd' }, ctx)).toBe(true)
    })
  })

  describe('combinators', () => {
    it('and returns true only when every clause matches', () => {
      const ctx = makeCtx({ values: { a: 1, b: 2 } })
      const rule: LogicRule = {
        op: 'and',
        rules: [
          { op: 'eq', field: 'a', value: 1 },
          { op: 'eq', field: 'b', value: 2 },
        ],
      }
      expect(evaluateLogicRule(rule, ctx)).toBe(true)
      const rule2: LogicRule = {
        op: 'and',
        rules: [
          { op: 'eq', field: 'a', value: 1 },
          { op: 'eq', field: 'b', value: 999 },
        ],
      }
      expect(evaluateLogicRule(rule2, ctx)).toBe(false)
    })

    it('or returns true if any clause matches', () => {
      const ctx = makeCtx({ values: { a: 1 } })
      const rule: LogicRule = {
        op: 'or',
        rules: [
          { op: 'eq', field: 'a', value: 999 },
          { op: 'eq', field: 'a', value: 1 },
        ],
      }
      expect(evaluateLogicRule(rule, ctx)).toBe(true)
    })

    it('not inverts the inner rule', () => {
      const ctx = makeCtx({ values: { a: 1 } })
      expect(
        evaluateLogicRule({ op: 'not', rule: { op: 'eq', field: 'a', value: 1 } }, ctx),
      ).toBe(false)
      expect(
        evaluateLogicRule({ op: 'not', rule: { op: 'eq', field: 'a', value: 2 } }, ctx),
      ).toBe(true)
    })

    it('nested and/or/not compositions work end-to-end', () => {
      const ctx = makeCtx({ values: { severity: 'high', mitigated: false } })
      const rule: LogicRule = {
        op: 'or',
        rules: [
          {
            op: 'and',
            rules: [
              { op: 'eq', field: 'severity', value: 'high' },
              { op: 'not', rule: { op: 'eq', field: 'mitigated', value: true } },
            ],
          },
          { op: 'eq', field: 'severity', value: 'critical' },
        ],
      }
      expect(evaluateLogicRule(rule, ctx)).toBe(true)
    })
  })
})

// =========================================================================
// Formula evaluator
// =========================================================================

describe('evaluateFormulaTree', () => {
  it('literal returns the literal value', () => {
    expect(
      evaluateFormulaTree({ kind: 'literal', value: 42 }, makeCtx()),
    ).toBe(42)
    expect(
      evaluateFormulaTree({ kind: 'literal', value: 'hi' }, makeCtx()),
    ).toBe('hi')
  })

  it('field_ref reads from values; null when missing', () => {
    const ctx = makeCtx({ values: { weight: 100, label: 'crate' } })
    expect(
      evaluateFormulaTree({ kind: 'field_ref', fieldKey: 'weight' }, ctx),
    ).toBe(100)
    expect(
      evaluateFormulaTree({ kind: 'field_ref', fieldKey: 'label' }, ctx),
    ).toBe('crate')
    expect(
      evaluateFormulaTree({ kind: 'field_ref', fieldKey: 'missing' }, ctx),
    ).toBe(null)
  })

  it('sum + product across arrays', () => {
    expect(
      evaluateFormulaTree(
        {
          kind: 'sum',
          of: [
            { kind: 'literal', value: 1 },
            { kind: 'literal', value: 2 },
            { kind: 'literal', value: 3 },
          ],
        },
        makeCtx(),
      ),
    ).toBe(6)
    expect(
      evaluateFormulaTree(
        {
          kind: 'product',
          of: [
            { kind: 'literal', value: 2 },
            { kind: 'literal', value: 3 },
            { kind: 'literal', value: 4 },
          ],
        },
        makeCtx(),
      ),
    ).toBe(24)
  })

  it('subtract + divide work; divide-by-zero returns 0', () => {
    expect(
      evaluateFormulaTree(
        {
          kind: 'subtract',
          left: { kind: 'literal', value: 10 },
          right: { kind: 'literal', value: 4 },
        },
        makeCtx(),
      ),
    ).toBe(6)
    expect(
      evaluateFormulaTree(
        {
          kind: 'divide',
          left: { kind: 'literal', value: 10 },
          right: { kind: 'literal', value: 2 },
        },
        makeCtx(),
      ),
    ).toBe(5)
    expect(
      evaluateFormulaTree(
        {
          kind: 'divide',
          left: { kind: 'literal', value: 10 },
          right: { kind: 'literal', value: 0 },
        },
        makeCtx(),
      ),
    ).toBe(0)
  })

  it('min + max return extremes', () => {
    expect(
      evaluateFormulaTree(
        {
          kind: 'min',
          of: [
            { kind: 'literal', value: 5 },
            { kind: 'literal', value: 2 },
            { kind: 'literal', value: 8 },
          ],
        },
        makeCtx(),
      ),
    ).toBe(2)
    expect(
      evaluateFormulaTree(
        {
          kind: 'max',
          of: [
            { kind: 'literal', value: 5 },
            { kind: 'literal', value: 2 },
            { kind: 'literal', value: 8 },
          ],
        },
        makeCtx(),
      ),
    ).toBe(8)
  })

  it('sum_section walks repeating rows; count_section counts them', () => {
    const ctx = makeCtx({
      rows: {
        loads: [
          { weight: 100, rigging: 20 },
          { weight: 250, rigging: 50 },
          { weight: 75, rigging: 15 },
        ],
      },
    })
    expect(
      evaluateFormulaTree(
        { kind: 'sum_section', sectionKey: 'loads', rowFieldKey: 'weight' },
        ctx,
      ),
    ).toBe(425)
    expect(
      evaluateFormulaTree(
        { kind: 'sum_section', sectionKey: 'loads', rowFieldKey: 'rigging' },
        ctx,
      ),
    ).toBe(85)
    expect(
      evaluateFormulaTree(
        { kind: 'count_section', sectionKey: 'loads' },
        ctx,
      ),
    ).toBe(3)
    expect(
      evaluateFormulaTree(
        { kind: 'sum_section', sectionKey: 'missing', rowFieldKey: 'x' },
        ctx,
      ),
    ).toBe(0)
  })

  it('concat joins values with separator', () => {
    const ctx = makeCtx({ values: { first: 'Alice', last: 'Smith' } })
    expect(
      evaluateFormulaTree(
        {
          kind: 'concat',
          separator: ' ',
          of: [
            { kind: 'field_ref', fieldKey: 'first' },
            { kind: 'field_ref', fieldKey: 'last' },
          ],
        },
        ctx,
      ),
    ).toBe('Alice Smith')
  })

  it('if branches on a logic rule', () => {
    const ctx = makeCtx({ values: { tier: 'gold' } })
    const formula: FormulaExpression = {
      kind: 'if',
      condition: { op: 'eq', field: 'tier', value: 'gold' },
      then: { kind: 'literal', value: 100 },
      else: { kind: 'literal', value: 0 },
    }
    expect(evaluateFormulaTree(formula, ctx)).toBe(100)
    expect(
      evaluateFormulaTree(formula, makeCtx({ values: { tier: 'silver' } })),
    ).toBe(0)
  })

  it('composes the lift-plan total-weight formula', () => {
    // sum_section('loads', 'load_weight_lbs') + sum_section('loads', 'rigging_weight_lbs')
    const ctx = makeCtx({
      rows: {
        loads: [
          { load_weight_lbs: 1000, rigging_weight_lbs: 200 },
          { load_weight_lbs: 500, rigging_weight_lbs: 50 },
        ],
      },
    })
    const total: FormulaExpression = {
      kind: 'sum',
      of: [
        { kind: 'sum_section', sectionKey: 'loads', rowFieldKey: 'load_weight_lbs' },
        { kind: 'sum_section', sectionKey: 'loads', rowFieldKey: 'rigging_weight_lbs' },
      ],
    }
    expect(evaluateFormulaTree(total, ctx)).toBe(1750)
  })
})

// =========================================================================
// Default-value resolver
// =========================================================================

describe('resolveDefaultValue', () => {
  it('literal passes through', () => {
    expect(
      resolveDefaultValue({ kind: 'literal', value: 'hello' }, makeCtx()),
    ).toBe('hello')
    expect(resolveDefaultValue({ kind: 'literal', value: 7 }, makeCtx())).toBe(7)
  })

  it('today returns yyyy-mm-dd', () => {
    const fixed = new Date('2025-03-15T12:00:00Z')
    expect(
      resolveDefaultValue(
        { kind: 'today' },
        makeCtx({ requestContext: { now: fixed } }),
      ),
    ).toBe('2025-03-15')
  })

  it('now returns yyyy-mm-ddThh:mm', () => {
    const fixed = new Date('2025-03-15T14:25:00Z')
    expect(
      resolveDefaultValue(
        { kind: 'now' },
        makeCtx({ requestContext: { now: fixed } }),
      ),
    ).toBe('2025-03-15T14:25')
  })

  it('current_user_person_id + current_user_name read from context', () => {
    const ctx = makeCtx({
      requestContext: {
        currentUserPersonId: 'person-abc',
        currentUserName: 'Alice Smith',
      },
    })
    expect(resolveDefaultValue({ kind: 'current_user_person_id' }, ctx)).toBe('person-abc')
    expect(resolveDefaultValue({ kind: 'current_user_name' }, ctx)).toBe('Alice Smith')
  })

  it('expression evaluates a formula tree', () => {
    expect(
      resolveDefaultValue(
        {
          kind: 'expression',
          expr: {
            kind: 'sum',
            of: [
              { kind: 'literal', value: 2 },
              { kind: 'literal', value: 3 },
            ],
          },
        },
        makeCtx(),
      ),
    ).toBe(5)
  })
})
