import { describe, expect, it } from 'vitest'
import type { FormWorkflowStep } from '@beaconhs/forms-core'
import { showResponseWorkflow } from './_workflow-visibility'

const capture: FormWorkflowStep = {
  key: 'setup',
  title: { en: 'Setup' },
  assignee: { type: 'expression', expr: '$submitter' },
}

describe('response workflow visibility', () => {
  const visible = (steps: FormWorkflowStep[], reviewSetting?: boolean, hasRecordedSteps = false) =>
    showResponseWorkflow({ steps, reviewSetting, hasRecordedSteps })

  it('does not turn capture pages into pending approvals when scoring enables review', () => {
    expect(
      visible(['setup', 'access', 'protection', 'signoff'].map((key) => ({ ...capture, key }))),
    ).toBe(false)
  })

  it('keeps required workflow signatures visible', () => {
    expect(visible([{ ...capture, signatureRequired: true }])).toBe(true)
  })

  it.each<FormWorkflowStep['assignee']>([
    { type: 'role', role: 'supervisor' },
    { type: 'literal', userId: 'reviewer' },
    { type: 'expression', expr: '$supervisor' },
  ])('shows an assigned approval: $type', (assignee) => {
    expect(visible([{ ...capture, assignee }])).toBe(true)
  })

  it('preserves recorded workflow history for submitter-only steps', () => {
    expect(visible([capture], undefined, true)).toBe(true)
  })

  it('respects explicit review settings', () => {
    expect(visible([capture], true)).toBe(true)
    expect(visible([{ ...capture, signatureRequired: true }], false, true)).toBe(false)
  })
})
