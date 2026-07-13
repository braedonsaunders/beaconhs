import { describe, expect, it } from 'vitest'
import { emptyAutomationGraph } from '@beaconhs/forms-core'
import { normalizeFlowName, parseFlowGraph, parseFlowSubject } from './flow-policy'

describe('flow persistence policy', () => {
  it('accepts known modules and UUID form subjects only', () => {
    expect(parseFlowSubject({ type: 'module', key: 'incidents' })).toEqual({
      type: 'module',
      key: 'incidents',
    })
    expect(parseFlowSubject({ type: 'module', key: 'invented-module' })).toBeNull()
    expect(parseFlowSubject({ type: 'form_template', key: 'not-a-uuid' })).toBeNull()
    expect(
      parseFlowSubject({
        type: 'form_template',
        key: '00000000-0000-4000-8000-000000000001',
      }),
    ).not.toBeNull()
  })

  it('normalizes blank and oversized names at the write boundary', () => {
    expect(normalizeFlowName('   ')).toBe('Flow')
    expect(normalizeFlowName(`  ${'x'.repeat(250)}  `)).toHaveLength(200)
  })

  it('allows an empty draft but rejects duplicate and dangling graph identities', () => {
    expect(parseFlowGraph(emptyAutomationGraph())).toEqual({
      ok: true,
      graph: emptyAutomationGraph(),
    })

    const duplicate = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'same',
          type: 'trigger',
          position: { x: 0, y: 0 },
          data: { kind: 'trigger', trigger: { trigger: 'on_submit' } },
        },
        {
          id: 'same',
          type: 'trigger',
          position: { x: 1, y: 1 },
          data: { kind: 'trigger', trigger: { trigger: 'on_submit' } },
        },
      ],
      edges: [],
    }
    expect(parseFlowGraph(duplicate)).toMatchObject({ ok: false })

    const dangling = {
      schemaVersion: 1,
      nodes: [duplicate.nodes[0]],
      edges: [{ id: 'edge', source: 'same', target: 'missing', sourceHandle: 'next' }],
    }
    expect(parseFlowGraph(dangling)).toEqual({
      ok: false,
      error: 'Flow graph contains an edge to a missing node',
    })
    expect(
      parseFlowGraph({
        schemaVersion: 1,
        nodes: [
          {
            id: 'action',
            type: 'action',
            position: { x: 0, y: 0 },
            data: {
              kind: 'action',
              action: { action: 'notify_role', role: 'worker', message: 'Review this record' },
            },
          },
        ],
        edges: [],
      }),
    ).toEqual({ ok: false, error: 'Flow graph must contain a trigger' })
  })

  it('rejects operationally excessive graphs', () => {
    const graph = emptyAutomationGraph()
    graph.nodes = Array.from({ length: 251 }, (_, i) => ({
      id: `node-${i}`,
      type: 'trigger' as const,
      position: { x: i, y: i },
      data: { kind: 'trigger' as const, trigger: { trigger: 'on_submit' as const } },
    }))
    expect(parseFlowGraph(graph)).toEqual({
      ok: false,
      error: 'Flow graph cannot contain more than 250 nodes',
    })
  })
})
