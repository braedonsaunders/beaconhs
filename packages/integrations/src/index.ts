// Barrel for the outbound automation framework (trigger → mapping → destination).
export * from './types'
export { runIntegrations } from './run'
export { dispatchOne } from './dispatch'
export type { DispatchCtx } from './dispatch'
export { listTriggers, getTrigger, sampleItem, TRIGGERS } from './triggers/registry'
export { listDestinations, getDestination, DESTINATIONS } from './destinations/registry'
export * from './triggers/emit'
