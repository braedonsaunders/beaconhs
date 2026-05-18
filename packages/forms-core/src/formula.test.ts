import { describe, expect, it } from 'vitest'
import { evaluateFormula } from './formula'

describe('evaluateFormula', () => {
  it('handles arithmetic', () => {
    expect(evaluateFormula('1 + 2 * 3', {})).toBe(7)
    expect(evaluateFormula('(1 + 2) * 3', {})).toBe(9)
  })

  it('reads field refs', () => {
    expect(evaluateFormula('severity * likelihood', { severity: 3, likelihood: 4 })).toBe(12)
  })

  it('uses helper functions', () => {
    expect(evaluateFormula('max(a, b, c)', { a: 1, b: 7, c: 4 })).toBe(7)
    expect(evaluateFormula('sum(1, 2, 3, 4)', {})).toBe(10)
  })

  it('handles if/else', () => {
    expect(evaluateFormula('if(score >= 80, 1, 0)', { score: 90 })).toBe(1)
    expect(evaluateFormula('if(score >= 80, 1, 0)', { score: 50 })).toBe(0)
  })

  it('treats missing refs as 0', () => {
    expect(evaluateFormula('a + b', { a: 5 })).toBe(5)
  })
})
