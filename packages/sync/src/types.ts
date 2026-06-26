// The connector contract — the single abstraction every connector implements,
// whether native (we coded it: database, csv) or provider-backed (brokers many
// sources: nango). Everything lands through the same spine (crosswalk + upsert).

import type { SyncEntityKey } from '@beaconhs/db/schema'

export type { SyncEntityKey }

// --- Canonical record shapes (what a connector emits) ---------------------

export interface CanonicalPerson {
  fullName?: string | null
  firstName: string
  lastName: string
  employeeNo?: string | null
  externalEmployeeId?: string | null
  email?: string | null
  phone?: string | null
  jobTitle?: string | null
  departmentName?: string | null
  tradeName?: string | null
  hireDate?: string | null // YYYY-MM-DD
  status?: 'active' | 'inactive' | 'terminated'
  metadata?: Record<string, unknown>
}

export interface CanonicalOrgUnit {
  name: string
  code?: string | null
  level?: 'customer' | 'project' | 'site' | 'area'
  parentCode?: string | null // resolved to parentId via the code lookup
  lat?: number | null
  lng?: number | null
  geofenceMeters?: number | null
  address?: {
    line1?: string
    line2?: string
    city?: string
    region?: string
    postal?: string
    country?: string
  } | null
  metadata?: Record<string, unknown>
}

export interface CanonicalEquipment {
  name: string
  assetTag: string
  serialNumber?: string | null
  description?: string | null
  typeName?: string | null
  status?: 'in_service' | 'out_of_service' | 'in_repair' | 'lost' | 'retired'
  metadata?: Record<string, unknown>
}

export type CanonicalRecord =
  | { entity: 'people'; externalId: string; data: CanonicalPerson }
  | { entity: 'org_unit'; externalId: string; data: CanonicalOrgUnit }
  | { entity: 'equipment'; externalId: string; data: CanonicalEquipment }

// --- Runtime context handed to connector methods --------------------------

export type SyncLogger = (level: 'info' | 'warn' | 'error', msg: string) => void
export type ResolvedSecrets = Record<string, string>

export interface ConnectorRunContext {
  tenantId: string
  connectionId: string
  config: Record<string, unknown>
  secrets: ResolvedSecrets
  since?: string | null // last successful cursor (reserved for incremental)
  log: SyncLogger
}

// --- Introspection (database connector) -----------------------------------

export interface IntrospectTable {
  name: string
  schema?: string
  rowCount?: number | null
}

export interface IntrospectColumn {
  name: string
  type: string
  nullable?: boolean
}

// --- Misc results ---------------------------------------------------------

export interface ConnectorTestResult {
  ok: boolean
  message?: string
}

export interface ConnectStartResult {
  kind: 'nango' | 'none'
  sessionToken?: string
  message?: string
}

// --- Declarative settings form (simple connectors render from these) ------

export interface ConfigField {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'textarea' | 'boolean'
  options?: { value: string; label: string }[]
  placeholder?: string
  help?: string
  required?: boolean
}

export interface SecretField {
  key: string
  label: string
  required?: boolean
  help?: string
}

// --- The connector itself -------------------------------------------------

export interface Connector {
  key: string
  name: string
  description: string
  kind: 'native' | 'provider'
  iconKey?: string
  entities: SyncEntityKey[]
  configFields?: ConfigField[]
  secretFields?: SecretField[]
  supportsIntrospection?: boolean
  supportsConnect?: boolean

  test?(ctx: ConnectorRunContext): Promise<ConnectorTestResult>
  introspect?(ctx: ConnectorRunContext): Promise<{ tables: IntrospectTable[] }>
  introspectTable?(
    ctx: ConnectorRunContext,
    table: { name: string; schema?: string },
  ): Promise<{ columns: IntrospectColumn[] }>
  startConnect?(ctx: ConnectorRunContext): Promise<ConnectStartResult>
  pull(ctx: ConnectorRunContext): Promise<CanonicalRecord[]>
  // Reserved for write-back (M3). Not wired yet.
  push?(ctx: ConnectorRunContext, records: CanonicalRecord[]): Promise<void>
}

// Plain, client-safe view of a connector (no methods) for passing to UI.
export interface ConnectorSummary {
  key: string
  name: string
  description: string
  kind: 'native' | 'provider'
  iconKey?: string
  entities: SyncEntityKey[]
  configFields: ConfigField[]
  secretFields: SecretField[]
  supportsIntrospection: boolean
  supportsConnect: boolean
}

export function toConnectorSummary(c: Connector): ConnectorSummary {
  return {
    key: c.key,
    name: c.name,
    description: c.description,
    kind: c.kind,
    iconKey: c.iconKey,
    entities: c.entities,
    configFields: c.configFields ?? [],
    secretFields: c.secretFields ?? [],
    supportsIntrospection: c.supportsIntrospection ?? false,
    supportsConnect: c.supportsConnect ?? false,
  }
}
