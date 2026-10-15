import { describe, expect, it } from 'vitest'
import {
  criterionAssignmentWire,
  criterionFieldId,
  parseCriterionFieldId,
} from './criterion-fields'

const ROW = '5b0f3c3e-2f7a-4d6e-9a51-0c6f4c1b2d3e'
const FIELDS = ['answer', 'severity'] as const

describe('criterion field ids', () => {
  it('round-trips a row and field', () => {
    expect(criterionFieldId(ROW, 'answer')).toBe(`criteria:${ROW}:answer`)
    expect(parseCriterionFieldId(criterionFieldId(ROW, 'severity'), FIELDS)).toEqual({
      rowId: ROW,
      field: 'severity',
    })
  })

  it('refuses record columns, unknown fields, malformed rows, and extra segments', () => {
    expect(parseCriterionFieldId('notes', FIELDS)).toBeNull()
    expect(parseCriterionFieldId(`criteria:${ROW}:comment`, FIELDS)).toBeNull()
    expect(parseCriterionFieldId('criteria:not-a-uuid:answer', FIELDS)).toBeNull()
    expect(parseCriterionFieldId(`criteria:${ROW}:answer:extra`, FIELDS)).toBeNull()
    expect(parseCriterionFieldId(`custom:${ROW}:answer`, FIELDS)).toBeNull()
  })

  it('spells an empty assignment with blanks, as the picker and date input do', () => {
    expect(criterionAssignmentWire(null, null)).toEqual({
      assignedToPersonId: '',
      assignedDueDate: '',
    })
    expect(criterionAssignmentWire(ROW, '2026-10-20')).toEqual({
      assignedToPersonId: ROW,
      assignedDueDate: '2026-10-20',
    })
  })
})
