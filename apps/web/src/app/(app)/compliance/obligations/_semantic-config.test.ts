import { describe, expect, it } from 'vitest'
import { obligationSemanticConfigChanged, type ObligationSemanticConfig } from './_semantic-config'

const BASE: ObligationSemanticConfig = {
  targetRef: { courseId: '10000000-0000-4000-8000-000000000001' },
  recurrence: { kind: 'frequency', frequency: 'year', quantity: 1 },
  audience: [
    { kind: 'department', entityKey: '10000000-0000-4000-8000-000000000002' },
    { kind: 'role', entityKey: 'worker' },
  ],
}

describe('obligation semantic configuration', () => {
  it('ignores audience ordering', () => {
    expect(
      obligationSemanticConfigChanged(BASE, {
        ...BASE,
        audience: [...BASE.audience].reverse(),
      }),
    ).toBe(false)
  })

  it('compares the JSONB shape rather than optional undefined properties', () => {
    expect(
      obligationSemanticConfigChanged(BASE, {
        ...BASE,
        targetRef: { ...BASE.targetRef, assessmentTypeId: undefined },
        recurrence: { ...BASE.recurrence, dueOffsetMinutes: undefined },
      }),
    ).toBe(false)
  })

  it('detects target changes', () => {
    expect(
      obligationSemanticConfigChanged(BASE, {
        ...BASE,
        targetRef: { courseId: '10000000-0000-4000-8000-000000000003' },
      }),
    ).toBe(true)
  })

  it('detects recurrence changes', () => {
    expect(
      obligationSemanticConfigChanged(BASE, {
        ...BASE,
        recurrence: { ...BASE.recurrence, quantity: 2 },
      }),
    ).toBe(true)
  })

  it('detects audience changes', () => {
    expect(
      obligationSemanticConfigChanged(BASE, {
        ...BASE,
        audience: [{ kind: 'everyone', entityKey: '' }],
      }),
    ).toBe(true)
  })
})
