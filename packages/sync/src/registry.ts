// The connector registry — code is the source of truth for what connectors
// exist (the admin UI reads this). Adding a connector = implement the contract
// and add it here.

import { csvConnector } from './connectors/csv'
import { databaseConnector } from './connectors/database'
import { httpJsonConnector } from './connectors/http-json'
import { nangoConnector } from './connectors/nango'
import { netsuiteConnector } from './connectors/netsuite'
import type { Connector } from './types'

export const CONNECTORS: Connector[] = [
  databaseConnector,
  httpJsonConnector,
  netsuiteConnector,
  csvConnector,
  nangoConnector,
]

export function listConnectors(): Connector[] {
  return CONNECTORS
}

export function getConnector(key: string): Connector | null {
  return CONNECTORS.find((c) => c.key === key) ?? null
}
