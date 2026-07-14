import type { AutomationGraph } from '@beaconhs/forms-core'
import {
  resolvePublicHost,
  validateOutboundRequestConfiguration,
  type OutboundDnsResolver,
} from '@beaconhs/sync/egress'

const WEBHOOK_CONFIGURATION_DNS_TIMEOUT_MS = 5_000
const MAX_SAFE_ERROR_LENGTH = 240

type FlowWebhookValidationResult = { ok: true } | { ok: false; error: string; nodeId: string }

/**
 * Produce an operator-useful failure without ever echoing a request body or
 * header value into a toast, audit record, or retry error.
 */
export function describeFlowWebhookError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Outbound request failed.'
  const sanitized = message
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (sanitized || 'Outbound request failed.').slice(0, MAX_SAFE_ERROR_LENGTH)
}

/**
 * Validate every tenant-authored webhook before a flow is saved or enabled.
 * URL policy is shared with runtime secureFetch. DNS is checked here to
 * give immediate feedback, then checked again and pinned at execution time to
 * close the save-to-run and DNS-rebinding windows.
 */
export async function validateFlowWebhookConfiguration(
  graph: AutomationGraph,
  options: { resolver?: OutboundDnsResolver; timeoutMs?: number } = {},
): Promise<FlowWebhookValidationResult> {
  const destinations = new Map<string, { hostname: string; nodeId: string }>()

  for (const node of graph.nodes) {
    if (node.data.kind !== 'action' || node.data.action.action !== 'webhook') continue
    const { action } = node.data
    try {
      const configured = validateOutboundRequestConfiguration(action.url, {
        'content-type': 'application/json',
      })
      if (!destinations.has(configured.url.hostname)) {
        destinations.set(configured.url.hostname, {
          hostname: configured.url.hostname,
          nodeId: node.id,
        })
      }
    } catch (error) {
      return {
        ok: false,
        nodeId: node.id,
        error: `Webhook action ${node.id}: ${describeFlowWebhookError(error)}`,
      }
    }
  }

  const results = await Promise.all(
    Array.from(destinations.values(), async (destination) => {
      try {
        await resolvePublicHost(destination.hostname, {
          timeoutMs: options.timeoutMs ?? WEBHOOK_CONFIGURATION_DNS_TIMEOUT_MS,
          resolver: options.resolver,
        })
        return null
      } catch (error) {
        return {
          ok: false as const,
          nodeId: destination.nodeId,
          error: `Webhook action ${destination.nodeId}: ${describeFlowWebhookError(error)}`,
        }
      }
    }),
  )

  return results.find((result) => result !== null) ?? { ok: true }
}
