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

it('invalidates targeting when an include becomes an exclusion', () => {
  expect(
    obligationSemanticConfigChanged(BASE, {
      ...BASE,
      audience: BASE.audience.map((row) => ({ ...row, excluded: true })),
    }),
  ).toBe(true)
  expect(
    obligationSemanticConfigChanged(BASE, {
      ...BASE,
      audience: BASE.audience.map((row) => ({ ...row, excluded: false })),
    }),
  ).toBe(false)
})

it('treats a worker-type change as a targeting change', () => {
  const config = { targetRef: {}, recurrence: { kind: 'one_time' as const }, audience: [] }
  expect(
    obligationSemanticConfigChanged(
      { ...config, workerType: 'all' },
      { ...config, workerType: 'employee' },
    ),
  ).toBe(true)
  expect(
    obligationSemanticConfigChanged(
      { ...config, workerType: 'contractor' },
      { ...config, workerType: 'contractor' },
    ),
  ).toBe(false)
})
