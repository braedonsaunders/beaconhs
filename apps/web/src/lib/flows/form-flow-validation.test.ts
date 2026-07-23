import { describe, expect, it } from 'vitest'
import type { AutomationGraph, FormSchemaV1 } from '@beaconhs/forms-core'
import { lintFormFlowGraph } from './form-flow-validation'

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  title: { en: 'Inspection' },
  workflow: {
    steps: [{ key: 'fill', title: { en: 'Fill' }, assignee: { type: 'role', role: 'worker' } }],
  },
  sections: [
    {
      id: 'main',
      title: { en: 'Main' },
      fields: [
        { id: 'notes', type: 'long_text', label: { en: 'Notes' } },
        { id: 'minutes', type: 'number', label: { en: 'Minutes' } },
        { id: 'photos', type: 'photo', label: { en: 'Photos' } },
        { id: 'heading', type: 'heading', label: { en: 'Heading' } },
      ],
    },
    {
      id: 'rows',
      title: { en: 'Rows' },
      repeating: true,
      fields: [{ id: 'row_note', type: 'text', label: { en: 'Row note' } }],
    },
  ],
}

function graph(action: AutomationGraph['nodes'][number]['data']): AutomationGraph {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: 'trigger',
        position: { x: 0, y: 0 },
        data: { kind: 'trigger', trigger: { trigger: 'on_submit' } },
      },
      { id: 'action', position: { x: 1, y: 0 }, data: action },
    ],
    edges: [{ id: 'edge', source: 'trigger', target: 'action' }],
  }
}

describe('lintFormFlowGraph', () => {
  it('allows valid stored-field, photo, and monitored-session actions', () => {
    expect(
      lintFormFlowGraph(
        graph({
          kind: 'action',
          action: { action: 'analyze_photos', fieldId: 'photos', storeInField: 'notes' },
        }),
        '00000000-0000-4000-8000-000000000001',
        'Inspection',
        schema,
      ),
    ).toEqual([])
  })

  it('rejects display/repeating writes and incompatible action fields', () => {
    const setHeading = lintFormFlowGraph(
      graph({
        kind: 'action',
        action: { action: 'set_field', field: 'heading', value: { kind: 'literal', value: 'x' } },
      }),
      '00000000-0000-4000-8000-000000000001',
      'Inspection',
      schema,
    )
    expect(setHeading.join('\n')).toMatch(/stored, top-level/)

    const repeating = lintFormFlowGraph(
      graph({
        kind: 'action',
        action: { action: 'set_field', field: 'row_note', value: { kind: 'literal', value: 'x' } },
      }),
      '00000000-0000-4000-8000-000000000001',
      'Inspection',
      schema,
    )
    expect(repeating.join('\n')).toMatch(/unknown field|top-level/)
  })
})
