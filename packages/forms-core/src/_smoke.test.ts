// Smoke-test that the lift-plan template schema (extended with the new
// foundation features — formula, conditional row visibility, multi-step,
// repeating min-rows, default values) parses cleanly through the runtime
// schema validator. This is the closest "integration" check we can run
// inside the forms-core package without dragging the db package in.

import { describe, expect, it } from 'vitest'
import { validateFormSchema, type FormSchemaV1 } from './schema'

const LIFT_PLAN_SCHEMA: FormSchemaV1 = {
  schemaVersion: 1,
  title: { en: 'Lift Plan' },
  sections: [
    {
      id: 'general_info',
      title: { en: 'General info' },
      step: 'plan',
      fields: [
        { id: 'lift_date', type: 'date', label: { en: 'Lift date' }, required: true, defaultValue: { kind: 'today' } },
        { id: 'supervisor', type: 'person_picker', label: { en: 'Lift supervisor' }, required: true, defaultValue: { kind: 'current_user_person_id' } },
      ],
    },
    {
      id: 'loads',
      title: { en: 'Loads' },
      step: 'plan',
      repeating: true,
      minRows: 1,
      rowLabelTemplate: 'Load #{index+1} · {description}',
      fields: [
        { id: 'description', type: 'text', label: { en: 'Description' }, required: true },
        { id: 'load_weight_lbs', type: 'number', label: { en: 'Load weight (lbs)' }, required: true },
        { id: 'rigging_weight_lbs', type: 'number', label: { en: 'Rigging weight (lbs)' } },
      ],
    },
    {
      id: 'totals',
      title: { en: 'Totals' },
      step: 'plan',
      fields: [
        {
          id: 'total_weight_lbs',
          type: 'formula',
          label: { en: 'Total weight (lbs)' },
          formula: {
            kind: 'sum',
            of: [
              { kind: 'sum_section', sectionKey: 'loads', rowFieldKey: 'load_weight_lbs' },
              { kind: 'sum_section', sectionKey: 'loads', rowFieldKey: 'rigging_weight_lbs' },
            ],
          },
        },
      ],
    },
    {
      id: 'hazards_controls',
      title: { en: 'Hazards & controls' },
      step: 'risk',
      repeating: true,
      fields: [
        { id: 'hazard', type: 'text', label: { en: 'Hazard' }, required: true },
        {
          id: 'residual_risk',
          type: 'select',
          label: { en: 'Residual risk' },
          required: true,
          validation: { options: [{ value: 'critical', label: { en: 'Critical' } }] },
        },
        {
          id: 'critical_control',
          type: 'textarea',
          label: { en: 'Additional control' },
          required: true,
          showIf: { op: 'eq', field: 'residual_risk', value: 'critical' },
        },
      ],
    },
  ],
  workflow: {
    steps: [
      {
        key: 'plan',
        title: { en: 'Plan' },
        assignee: { type: 'expression', expr: '$submitter' },
      },
      {
        key: 'risk',
        title: { en: 'Risk' },
        assignee: { type: 'expression', expr: '$submitter' },
      },
    ],
  },
}

describe('lift-plan-style schema integration', () => {
  it('parses through validateFormSchema with all foundation features', () => {
    const parsed = validateFormSchema(LIFT_PLAN_SCHEMA)
    expect(parsed.sections).toHaveLength(4)
    expect(parsed.workflow.steps).toHaveLength(2)
    // Repeating section bound to a step, with min rows + row-label-template.
    const loads = parsed.sections.find((s) => s.id === 'loads')!
    expect(loads.repeating).toBe(true)
    expect(loads.step).toBe('plan')
    expect(loads.minRows).toBe(1)
    expect(loads.rowLabelTemplate).toBe('Load #{index+1} · {description}')
    // Formula field carries a typed expression tree.
    const totals = parsed.sections.find((s) => s.id === 'totals')!
    const totalField = totals.fields.find((f) => f.id === 'total_weight_lbs')!
    expect(totalField.formula?.kind).toBe('sum')
    // Conditional showIf inside a repeating row.
    const hazards = parsed.sections.find((s) => s.id === 'hazards_controls')!
    const critCtl = hazards.fields.find((f) => f.id === 'critical_control')!
    expect(critCtl.showIf).toBeDefined()
    // Default-value expressions on top-level fields.
    const gen = parsed.sections.find((s) => s.id === 'general_info')!
    const liftDate = gen.fields.find((f) => f.id === 'lift_date')!
    expect(liftDate.defaultValue?.kind).toBe('today')
  })
})
