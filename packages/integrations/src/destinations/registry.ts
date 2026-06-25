// The destination catalog: every external service an automation can send to.
// Each is config-driven (configFields/secretFields render generically) with a
// pure deliver() + optional test(). Adding a service = one entry here.

import type { DestinationDef } from '../types'
import { httpDestination } from './http'
import { sqlDestination } from './sql'
import { slackDestination } from './slack'
import { sheetsDestination } from './sheets'
import { emailDestination } from './email'

export const DESTINATIONS: DestinationDef[] = [
  httpDestination,
  sqlDestination,
  slackDestination,
  sheetsDestination,
  emailDestination,
]

export function listDestinations(): DestinationDef[] {
  return DESTINATIONS
}

export function getDestination(key: string | null | undefined): DestinationDef | undefined {
  if (!key) return undefined
  return DESTINATIONS.find((d) => d.key === key)
}
