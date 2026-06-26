import { describe, expect, it } from 'vitest'
import { lintWorkerTriggerCompatibility, type AutomationGraph } from './automation'

function graphWith(action: AutomationGraph['nodes'][number]['data']): AutomationGraph {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: 'trigger',
        position: { x: 0, y: 0 },
        data: { kind: 'trigger', trigger: { trigger: 'scheduled', cron: '* * * * *' } },
      },
      { id: 'action', position: { x: 100, y: 0 }, data: action },
    ],
    edges: [{ id: 'edge', source: 'trigger', target: 'action', sourceHandle: 'next' }],
  }
}

describe('lintWorkerTriggerCompatibility', () => {
  it('allows inline worker-safe notifications', () => {
    expect(
      lintWorkerTriggerCompatibility(
        graphWith({
          kind: 'action',
          action: { action: 'notify_role', role: 'safety_manager', message: 'Reminder' },
        }),
      ),
    ).toEqual([])
  })

  it('rejects worker trigger branches that cannot execute in the worker', () => {
    expect(
      lintWorkerTriggerCompatibility(
        graphWith({
          kind: 'action',
          action: { action: 'create_capa', titleTemplate: 'Fix {{thing}}' },
        }),
      ),
    ).toContain('Trigger trigger: "scheduled" runs in the worker and cannot execute "create_capa".')
  })

  it('rejects template/pdf email modes for worker triggers', () => {
    expect(
      lintWorkerTriggerCompatibility(
        graphWith({
          kind: 'action',
          action: {
            action: 'send_email',
            to: [{ type: 'role', role: 'safety_manager' }],
            mode: 'template',
            templateId: 'tpl_1',
          },
        }),
      ),
    ).toContain(
      'Trigger trigger: "scheduled" can only send inline worker emails without PDF attachments.',
    )
  })
})
