import { describe, expect, it } from 'vitest'
import {
  lintWorkerTriggerCompatibility,
  planAutomation,
  actionDataSchema,
  type ActionData,
  type AutomationGraph,
  type TriggerData,
} from './automation'
import type { EvalContext } from './evaluator'

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

describe('send_email design source', () => {
  it('keeps bounded HTML as the sole editable source and drops project JSON', () => {
    const parsed = actionDataSchema.parse({
      action: 'send_email',
      to: [{ type: 'submitter' }],
      mode: 'design',
      sourceHtml: '<p>Hello</p>',
      compiledHtml: '<p>Hello</p>',
      design: { components: [{ script: 'alert(1)' }] },
    })

    expect(parsed).toMatchObject({ sourceHtml: '<p>Hello</p>', compiledHtml: '<p>Hello</p>' })
    expect(parsed).not.toHaveProperty('design')
    expect(() =>
      actionDataSchema.parse({
        action: 'send_email',
        to: [{ type: 'submitter' }],
        mode: 'design',
        sourceHtml: 'x'.repeat(512_001),
      }),
    ).toThrow()
  })
})

describe('contextual email recipients', () => {
  it('accepts department-scoped groups, location contacts, and compliance recipients', () => {
    const parsed = actionDataSchema.parse({
      action: 'send_email',
      to: [
        { type: 'person_group', groupId: 'safety-team' },
        {
          type: 'person_group_for_record_person',
          groupId: 'manager-group',
          personField: 'person_id',
        },
        {
          type: 'record_person_manager',
          personField: 'person_id',
        },
        {
          type: 'org_unit_contact',
          contactId: 'client-contact',
          orgUnitField: 'site_org_unit_id',
        },
        {
          type: 'compliance_recipient',
          obligationId: 'journal-assignment',
          personField: 'person_id',
          recipient: { type: 'person', personId: 'safety-manager' },
        },
      ],
    })

    expect(parsed).toMatchObject({ action: 'send_email', to: expect.any(Array) })
    if (parsed.action !== 'send_email') throw new Error('Expected a send-email action')
    expect(parsed.to).toHaveLength(5)
  })

  it('accepts conditional XLSX templates and limits attachment fan-out', () => {
    const attachment = {
      templateAttachmentId: 'template-id',
      filename: 'site-report.xlsx',
      when: { op: 'eq', field: 'site_org_unit_id', value: 'site-id' } as const,
    }
    expect(
      actionDataSchema.parse({
        action: 'send_email',
        to: [{ type: 'submitter' }],
        spreadsheetAttachments: [attachment],
      }),
    ).toMatchObject({ spreadsheetAttachments: [attachment] })
    expect(() =>
      actionDataSchema.parse({
        action: 'send_email',
        to: [{ type: 'submitter' }],
        spreadsheetAttachments: Array.from({ length: 11 }, () => attachment),
      }),
    ).toThrow()
  })
})

// --- Engine planning --------------------------------------------------------

const emptyCtx: EvalContext = { values: {}, rows: {}, entities: {} }

function notify(role: string): ActionData {
  return { action: 'notify_role', role, message: `to ${role}` }
}

/**
 * Build a graph where each entry pairs a trigger with a single notify_role
 * action wired straight off it, so `planAutomation` output can be asserted by
 * the collected action roles.
 */
function graphOf(triggers: Array<{ trigger: TriggerData; role: string }>): AutomationGraph {
  const nodes: AutomationGraph['nodes'] = []
  const edges: AutomationGraph['edges'] = []
  triggers.forEach(({ trigger, role }, i) => {
    const tId = `t${i}`
    const aId = `a${i}`
    nodes.push({ id: tId, position: { x: 0, y: i * 100 }, data: { kind: 'trigger', trigger } })
    nodes.push({
      id: aId,
      position: { x: 200, y: i * 100 },
      data: { kind: 'action', action: notify(role) },
    })
    edges.push({ id: `e${i}`, source: tId, target: aId, sourceHandle: 'next' })
  })
  return { schemaVersion: 1, nodes, edges }
}

function roles(
  graph: AutomationGraph,
  trigger: TriggerData['trigger'],
  ctx: EvalContext,
  opts?: {
    buttonId?: string
    fromStatus?: string | null
    toStatus?: string
    triggerNodeIds?: string[]
  },
): string[] {
  return planAutomation(graph, trigger, ctx, opts).actions.flatMap((a) =>
    a.action === 'notify_role' ? [a.role] : [],
  )
}

describe('planAutomation', () => {
  it('plans EVERY on_field_value trigger whose rule passes, not just the first', () => {
    const graph = graphOf([
      {
        trigger: { trigger: 'on_field_value', rule: { op: 'eq', field: 'a', value: 'no' } },
        role: 'first',
      },
      {
        trigger: { trigger: 'on_field_value', rule: { op: 'eq', field: 'a', value: 'yes' } },
        role: 'second',
      },
    ])
    const ctx: EvalContext = { values: { a: 'yes' }, rows: {}, entities: {} }
    // The FIRST trigger's rule fails; the second must still fire.
    expect(roles(graph, 'on_field_value', ctx)).toEqual(['second'])
  })

  it('collects branches from multiple satisfied triggers', () => {
    const graph = graphOf([
      { trigger: { trigger: 'on_submit' }, role: 'one' },
      { trigger: { trigger: 'on_submit' }, role: 'two' },
    ])
    expect(roles(graph, 'on_submit', emptyCtx).sort()).toEqual(['one', 'two'])
  })

  it('status_change honors the trigger `to` and `from` filters', () => {
    const graph = graphOf([
      {
        trigger: { trigger: 'status_change', from: 'in_review', to: 'closed' },
        role: 'reviewed_close',
      },
      { trigger: { trigger: 'status_change', to: 'closed' }, role: 'any_close' },
    ])
    // draft → closed: the from-scoped trigger must NOT fire; the open one does.
    expect(
      roles(graph, 'status_change', emptyCtx, { fromStatus: 'draft', toStatus: 'closed' }).sort(),
    ).toEqual(['any_close'])
    // in_review → closed: both fire.
    expect(
      roles(graph, 'status_change', emptyCtx, {
        fromStatus: 'in_review',
        toStatus: 'closed',
      }).sort(),
    ).toEqual(['any_close', 'reviewed_close'])
    // → open: neither fires.
    expect(roles(graph, 'status_change', emptyCtx, { toStatus: 'open' })).toEqual([])
  })

  it('manual planning targets a single button by id', () => {
    const graph = graphOf([
      {
        trigger: { trigger: 'manual', buttonId: 'b1', label: 'One' },
        role: 'one',
      },
      {
        trigger: { trigger: 'manual', buttonId: 'b2', label: 'Two' },
        role: 'two',
      },
    ])
    expect(roles(graph, 'manual', emptyCtx, { buttonId: 'b2' })).toEqual(['two'])
  })

  it('scheduled planning targets only trigger nodes that are due', () => {
    const graph = graphOf([
      { trigger: { trigger: 'scheduled', cron: '0 8 * * *' }, role: 'daily' },
      { trigger: { trigger: 'scheduled', cron: '0 8 * * 1' }, role: 'weekly' },
    ])
    expect(roles(graph, 'scheduled', emptyCtx, { triggerNodeIds: ['t1'] })).toEqual(['weekly'])
  })
})
