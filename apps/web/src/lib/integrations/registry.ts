// The outbound-integration code registry. First-party integrations are listed
// here; nothing is active until a tenant enables it in /admin/integrations.
//
// This is a plain code registry (like @beaconhs/sync's connectors), not the
// sandboxed plugin runtime — which keeps the build simple and is forward-
// compatible: when the plugin runtime lands, an entry here lifts into a real
// plugin with minimal change.

import type { IntegrationEventType, OutboundIntegration } from './types'
import { adminapp2Timesheet } from './adminapp2-timesheet'

const REGISTRY: OutboundIntegration[] = [adminapp2Timesheet]

export function listOutboundIntegrations(): OutboundIntegration[] {
  return REGISTRY
}

export function getOutboundIntegration(key: string): OutboundIntegration | undefined {
  return REGISTRY.find((i) => i.key === key)
}

export function integrationsForEvent(type: IntegrationEventType): OutboundIntegration[] {
  return REGISTRY.filter((i) => i.events.includes(type))
}
