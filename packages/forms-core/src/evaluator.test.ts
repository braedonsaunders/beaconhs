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
        evaluateLogicRule({ op: 'in', field: 'tier', value: ['silver', 'gold'] }, ctxScalar),
      ).toBe(true)
      expect(evaluateLogicRule({ op: 'notIn', field: 'tier', value: ['silver'] }, ctxScalar)).toBe(
        true,
      )

      const ctxArray = makeCtx({ values: { ppe: ['hard_hat', 'gloves'] } })
      expect(evaluateLogicRule({ op: 'in', field: 'ppe', value: ['gloves'] }, ctxArray)).toBe(true)
      expect(evaluateLogicRule({ op: 'notIn', field: 'ppe', value: ['gloves'] }, ctxArray)).toBe(
        false,
      )
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
      expect(evaluateLogicRule({ op: 'not', rule: { op: 'eq', field: 'a', value: 1 } }, ctx)).toBe(
        false,
      )
      expect(evaluateLogicRule({ op: 'not', rule: { op: 'eq', field: 'a', value: 2 } }, ctx)).toBe(
        true,
      )
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
    expect(evaluateFormulaTree({ kind: 'literal', value: 42 }, makeCtx())).toBe(42)
    expect(evaluateFormulaTree({ kind: 'literal', value: 'hi' }, makeCtx())).toBe('hi')
  })

  it('field_ref reads from values; null when missing', () => {
    const ctx = makeCtx({ values: { weight: 100, label: 'crate' } })
    expect(evaluateFormulaTree({ kind: 'field_ref', fieldKey: 'weight' }, ctx)).toBe(100)
    expect(evaluateFormulaTree({ kind: 'field_ref', fieldKey: 'label' }, ctx)).toBe('crate')
    expect(evaluateFormulaTree({ kind: 'field_ref', fieldKey: 'missing' }, ctx)).toBe(null)
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
      evaluateFormulaTree({ kind: 'sum_section', sectionKey: 'loads', rowFieldKey: 'weight' }, ctx),
    ).toBe(425)
    expect(
      evaluateFormulaTree(
        { kind: 'sum_section', sectionKey: 'loads', rowFieldKey: 'rigging' },
        ctx,
      ),
    ).toBe(85)
    expect(evaluateFormulaTree({ kind: 'count_section', sectionKey: 'loads' }, ctx)).toBe(3)
    expect(
      evaluateFormulaTree({ kind: 'sum_section', sectionKey: 'missing', rowFieldKey: 'x' }, ctx),
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
    expect(evaluateFormulaTree(formula, makeCtx({ values: { tier: 'silver' } }))).toBe(0)
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

  // -------- entity_attr -----------------------------------------------------

  describe('entity_attr', () => {
    it('returns the attr value when the entities map has an entry', () => {
      const ctx = makeCtx({
        values: { supervisor: 'person-1' },
        entities: {
          supervisor: {
            __entityKind: 'person',
            displayName: 'Alice Foreman',
            jobTitle: 'Site Supervisor',
          },
        },
      })
      expect(
        evaluateFormulaTree(
          { kind: 'entity_attr', pickerFieldKey: 'supervisor', attrKey: 'jobTitle' },
          ctx,
        ),
      ).toBe('Site Supervisor')
      expect(
        evaluateFormulaTree(
          { kind: 'entity_attr', pickerFieldKey: 'supervisor', attrKey: 'displayName' },
          ctx,
        ),
      ).toBe('Alice Foreman')
    })

    it('returns null when the picker is empty / entity not loaded', () => {
      const ctxNoEntities = makeCtx({ values: { supervisor: 'person-1' } })
      expect(
        evaluateFormulaTree(
          { kind: 'entity_attr', pickerFieldKey: 'supervisor', attrKey: 'jobTitle' },
          ctxNoEntities,
        ),
      ).toBe(null)

      const ctxNullEntry = makeCtx({
        values: { supervisor: '' },
        entities: { supervisor: null },
      })
      expect(
        evaluateFormulaTree(
          { kind: 'entity_attr', pickerFieldKey: 'supervisor', attrKey: 'jobTitle' },
          ctxNullEntry,
        ),
      ).toBe(null)

      const ctxMissingAttr = makeCtx({
        entities: {
          supervisor: { __entityKind: 'person', displayName: 'Alice Foreman' },
        },
      })
      expect(
        evaluateFormulaTree(
          { kind: 'entity_attr', pickerFieldKey: 'supervisor', attrKey: 'jobTitle' },
          ctxMissingAttr,
        ),
      ).toBe(null)
    })

    it('normalizes allowlisted date attributes to ISO strings', () => {
      const fixed = new Date('2025-08-10T12:00:00Z')
      const dateCtx = makeCtx({
        entities: {
          supervisor: { __entityKind: 'person', hireDate: fixed },
        },
      })
      expect(
        evaluateFormulaTree(
          { kind: 'entity_attr', pickerFieldKey: 'supervisor', attrKey: 'hireDate' },
          dateCtx,
        ),
      ).toBe('2025-08-10T12:00:00.000Z')
    })

    it('composes supervisor job title via entity_attr (end-to-end shape)', () => {
      // Mirrors the lift-plan template's `supervisor_job_title` formula.
      // The evaluator should resolve the attr against the loaded entities
      // map the filler runtime passes through.
      const ctx = makeCtx({
        values: { supervisor: 'person-42' },
        entities: {
          supervisor: {
            __entityKind: 'person',
            displayName: 'Jordan Lopez',
            jobTitle: 'Crane Supervisor',
            email: 'jordan@example.com',
          },
        },
      })
      const formula: FormulaExpression = {
        kind: 'entity_attr',
        pickerFieldKey: 'supervisor',
        attrKey: 'jobTitle',
      }
      expect(evaluateFormulaTree(formula, ctx)).toBe('Crane Supervisor')
    })

    it('falls back to primitive passthrough when __entityKind is missing', () => {
      // Defence-in-depth: entity_attr should still surface scalar values
      // even if the loader forgets to stamp __entityKind.
      const ctx = makeCtx({
        entities: {
          supervisor: { jobTitle: 'Site Supervisor' },
        },
      })
      expect(
        evaluateFormulaTree(
          { kind: 'entity_attr', pickerFieldKey: 'supervisor', attrKey: 'jobTitle' },
          ctx,
        ),
      ).toBe('Site Supervisor')
    })

    it('returns null when the attr key is not in ENTITY_ATTRS for the kind', () => {
      // A designer who hand-crafted JSON could request an attr we never
      // allowlisted. The evaluator falls through to the primitive pathway,
      // which still returns the value if it's scalar — but the loader is
      // the gate; in production the row simply won't carry the column.
      const ctx = makeCtx({
        entities: {
          supervisor: {
            __entityKind: 'person',
            // No `notAnAttr` allowlisted for 'person'.
          },
        },
      })
      expect(
        evaluateFormulaTree(
          { kind: 'entity_attr', pickerFieldKey: 'supervisor', attrKey: 'notAnAttr' },
          ctx,
        ),
      ).toBe(null)
    })
  })
})

// =========================================================================
// Scientific math operators (power / root / abs / round / floor / ceil)
// =========================================================================

describe('evaluateFormulaTree — scientific math', () => {
  const lit = (value: number): FormulaExpression => ({ kind: 'literal', value })

  it('power raises base to exponent', () => {
    expect(evaluateFormulaTree({ kind: 'power', base: lit(2), exponent: lit(10) }, makeCtx())).toBe(
      1024,
    )
    expect(
      evaluateFormulaTree({ kind: 'power', base: lit(9), exponent: lit(0.5) }, makeCtx()),
    ).toBe(3)
  })

  it('power guards NaN (even root of a negative) → 0', () => {
    expect(
      evaluateFormulaTree({ kind: 'power', base: lit(-1), exponent: lit(0.5) }, makeCtx()),
    ).toBe(0)
  })

  it('root takes the nth root, preserving sign for odd roots', () => {
    expect(
      evaluateFormulaTree({ kind: 'root', of: lit(9), degree: lit(2) }, makeCtx()),
    ).toBeCloseTo(3, 9)
    expect(
      evaluateFormulaTree({ kind: 'root', of: lit(27), degree: lit(3) }, makeCtx()),
    ).toBeCloseTo(3, 9)
    // cube root of −8 = −2 (not NaN)
    expect(
      evaluateFormulaTree({ kind: 'root', of: lit(-8), degree: lit(3) }, makeCtx()),
    ).toBeCloseTo(-2, 9)
  })

  it('root by degree 0 short-circuits to 0', () => {
    expect(evaluateFormulaTree({ kind: 'root', of: lit(9), degree: lit(0) }, makeCtx())).toBe(0)
  })

  it('abs returns magnitude', () => {
    expect(evaluateFormulaTree({ kind: 'abs', of: lit(-5) }, makeCtx())).toBe(5)
    expect(evaluateFormulaTree({ kind: 'abs', of: lit(5) }, makeCtx())).toBe(5)
  })

  it('round honours places; defaults to 0 decimals', () => {
    expect(evaluateFormulaTree({ kind: 'round', of: lit(3.14159), places: 2 }, makeCtx())).toBe(
      3.14,
    )
    expect(evaluateFormulaTree({ kind: 'round', of: lit(123.456) }, makeCtx())).toBe(123)
    expect(
      evaluateFormulaTree({ kind: 'round', of: lit(123.456), places: 1_000_000 }, makeCtx()),
    ).toBe(123)
  })

  it('floor + ceil round toward −∞ / +∞', () => {
    expect(evaluateFormulaTree({ kind: 'floor', of: lit(2.9) }, makeCtx())).toBe(2)
    expect(evaluateFormulaTree({ kind: 'ceil', of: lit(2.1) }, makeCtx())).toBe(3)
  })

  it('composes a pythagorean hypotenuse: root(a²+b², 2)', () => {
    const ctx = makeCtx({ values: { a: 3, b: 4 } })
    const hyp: FormulaExpression = {
      kind: 'root',
      degree: lit(2),
      of: {
        kind: 'sum',
        of: [
          { kind: 'power', base: { kind: 'field_ref', fieldKey: 'a' }, exponent: lit(2) },
          { kind: 'power', base: { kind: 'field_ref', fieldKey: 'b' }, exponent: lit(2) },
        ],
      },
    }
    expect(evaluateFormulaTree(hyp, ctx)).toBeCloseTo(5, 9)
  })
})

// =========================================================================
// Default-value resolver
// =========================================================================

describe('resolveDefaultValue', () => {
  it('literal passes through', () => {
    expect(resolveDefaultValue({ kind: 'literal', value: 'hello' }, makeCtx())).toBe('hello')
    expect(resolveDefaultValue({ kind: 'literal', value: 7 }, makeCtx())).toBe(7)
  })

  it('today returns the LOCAL yyyy-mm-dd', () => {
    // Date inputs expect the local wall-clock date, so the expected value is
    // derived from local components (not the UTC slice) to stay correct in any
    // runner timezone.
    const fixed = new Date('2025-03-15T12:00:00Z')
    const p = (n: number) => String(n).padStart(2, '0')
    const expected = `${fixed.getFullYear()}-${p(fixed.getMonth() + 1)}-${p(fixed.getDate())}`
    expect(
      resolveDefaultValue({ kind: 'today' }, makeCtx({ requestContext: { now: fixed } })),
    ).toBe(expected)
  })

  it('now returns the LOCAL yyyy-mm-ddThh:mm', () => {
    const fixed = new Date('2025-03-15T14:25:00Z')
    const p = (n: number) => String(n).padStart(2, '0')
    const expected =
      `${fixed.getFullYear()}-${p(fixed.getMonth() + 1)}-${p(fixed.getDate())}` +
      `T${p(fixed.getHours())}:${p(fixed.getMinutes())}`
    expect(resolveDefaultValue({ kind: 'now' }, makeCtx({ requestContext: { now: fixed } }))).toBe(
      expected,
    )
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
