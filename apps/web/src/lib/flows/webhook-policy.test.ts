import { describe, expect, it } from 'vitest'
import type { AutomationGraph } from '@beaconhs/forms-core'
import { describeFlowWebhookError, validateFlowWebhookConfiguration } from './webhook-policy'

function webhookGraph(url: string): AutomationGraph {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: 'trigger',
        position: { x: 0, y: 0 },
        data: { kind: 'trigger', trigger: { trigger: 'on_submit' } },
      },
      {
        id: 'webhook',
        position: { x: 100, y: 0 },
        data: {
          kind: 'action',
          action: { action: 'webhook', url, method: 'POST' },
        },
      },
    ],
    edges: [{ id: 'edge', source: 'trigger', target: 'webhook', sourceHandle: 'next' }],
  }
}

describe('flow webhook persistence policy', () => {
  it.each([
    ['plain HTTP', 'http://hooks.example.com/receive', /must use HTTPS/],
    ['localhost', 'https://localhost/receive', /reserved for local or private use/],
    ['private IPv4', 'https://10.1.2.3/receive', /blocked non-public/],
    ['IPv6 loopback', 'https://[::1]/receive', /blocked non-public/],
  ])('rejects %s destinations', async (_label, url, error) => {
    const result = await validateFlowWebhookConfiguration(webhookGraph(url), {
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    })
    expect(result).toMatchObject({
      ok: false,
      nodeId: 'webhook',
      error: expect.stringMatching(error),
    })
  })

  it('rejects a public-looking hostname when DNS includes a private answer', async () => {
    const result = await validateFlowWebhookConfiguration(
      webhookGraph('https://hooks.example.com/receive'),
      {
        resolver: async () => [
          { address: '93.184.216.34', family: 4 },
          { address: '169.254.169.254', family: 4 },
        ],
      },
    )
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/blocked non-public/) })
  })

  it('accepts a public HTTPS destination and resolves a repeated host only once', async () => {
    const graph = webhookGraph('https://hooks.example.com/first')
    graph.nodes.push({
      id: 'webhook-two',
      position: { x: 200, y: 0 },
      data: {
        kind: 'action',
        action: {
          action: 'webhook',
          url: 'https://hooks.example.com/second',
          method: 'PUT',
        },
      },
    })
    let calls = 0
    const result = await validateFlowWebhookConfiguration(graph, {
      resolver: async () => {
        calls++
        return [{ address: '93.184.216.34', family: 4 }]
      },
    })
    expect(result).toEqual({ ok: true })
    expect(calls).toBe(1)
  })

  it('sanitizes failure detail without exposing request values', () => {
    expect(describeFlowWebhookError(new Error('failure\nwith\tcontrols'))).toBe(
      'failure with controls',
    )
    expect(describeFlowWebhookError(null)).toBe('Outbound request failed.')
  })
})
