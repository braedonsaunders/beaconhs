// Barrel for the outbound automation framework (trigger → mapping → destination).
export * from './types'
export { publishIntegrationEvent } from './run'
export { dispatchOne } from './dispatch'
export type { DispatchCtx } from './dispatch'
export { listTriggers, getTrigger, sampleItem, TRIGGERS } from './triggers/registry'
export { listDestinations, getDestination, DESTINATIONS } from './destinations/registry'
export * from './triggers/emit'
export {
  DEFAULT_CREDITED_HOURS_PER_DAY,
  MAX_CLASS_LENGTH_DAYS,
  calendarDateInTimeZone,
  deriveClassLengthDays,
  expandClassDays,
  resolveClassCredit,
  type ClassCredit,
  type ClassDaysInput,
} from './class-days'
