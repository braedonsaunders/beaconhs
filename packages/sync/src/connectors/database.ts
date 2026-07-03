// Generic SQL database connector (native). Connects to PostgreSQL / MySQL /
// MariaDB / SQL Server, can browse tables + columns live (introspection), and
// pulls rows from admin-mapped tables → canonical records. Password is the only
// secret. Incremental sync is opt-in per mapping with cursorColumn; full pulls
// remain the default and are idempotent via the crosswalk.

import { connectDb, type DbConn, type DbKind } from '../db-drivers'
import type { CanonicalRecord, Connector, ConnectorRunContext, SyncEntityKey } from '../types'
import { datePart, hashRow, numPart, orgLevel, renderTemplate, splitName } from '../transform'

type FieldValues = Record<string, string>

interface EntityMapping {
  label?: string
  table?: string
  schema?: string
  query?: string
  where?: string
  idColumn?: string
  externalIdTemplate?: string
  cursorColumn?: string
  columns: Record<string, string> // canonical field → source column
  values?: FieldValues // canonical field → static value or {{SourceColumn}} template
}

interface DbConfig {
  dbKind: DbKind
  host: string
  port?: number
  database: string
  username: string
  ssl?: boolean
  mappings?: Partial<Record<SyncEntityKey, EntityMapping | EntityMapping[]>>
}

function cfgOf(ctx: ConnectorRunContext): DbConfig {
  return ctx.config as unknown as DbConfig
}

async function open(ctx: ConnectorRunContext): Promise<DbConn> {
  const c = cfgOf(ctx)
  return connectDb({
    dbKind: c.dbKind,
    host: c.host,
    port: c.port,
    database: c.database,
    username: c.username,
    password: ctx.secrets.password ?? '',
    ssl: c.ssl,
  })
}

function qid(kind: DbKind, name: string): string {
  if (kind === 'mssql') return `[${name.replace(/]/g, ']]')}]`
  if (kind === 'mysql' || kind === 'mariadb') return `\`${name.replace(/`/g, '``')}\``
  return `"${name.replace(/"/g, '""')}"`
}

function qpath(kind: DbKind, path: string): string {
  return path
    .split('.')
    .map((part) => qid(kind, part.trim()))
    .join('.')
}

function literal(v: unknown): string {
  if (v == null) return 'NULL'
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'boolean') return v ? '1' : '0'
  return `'${String(v).replace(/'/g, "''")}'`
}

function withCursorPredicate(
  kind: DbKind,
  base: string,
  m: EntityMapping,
  cursor: unknown,
): string {
  if (!m.cursorColumn?.trim() || cursor == null) return base
  const pred = `${qpath(kind, m.cursorColumn.trim())} > ${literal(cursor)}`
  if (m.query && m.query.trim()) return `SELECT * FROM (${base}) AS beaconhs_src WHERE ${pred}`
  return `${base} ${base.toLowerCase().includes(' where ') ? 'AND' : 'WHERE'} ${pred}`
}

function buildSelect(kind: DbKind, m: EntityMapping, cursor: unknown): string {
  if (m.query && m.query.trim()) return withCursorPredicate(kind, m.query.trim(), m, cursor)
  if (!m.table)
    throw new Error('Database mapping requires either a source table or a custom query.')
  const target = m.schema ? `${qid(kind, m.schema)}.${qid(kind, m.table)}` : qid(kind, m.table)
  let q = `SELECT * FROM ${target}`
  if (m.where && m.where.trim()) q += ` WHERE ${m.where.trim()}`
  return withCursorPredicate(kind, q, m, cursor)
}

function val(row: Record<string, unknown>, col: string | undefined | null): string | null {
  if (!col) return null
  const v = row[col]
  if (v == null) return null
  if (v instanceof Date) return v.toISOString()
  const s = String(v)
  return s === '' ? null : s
}

function boolish(v: string | null): boolean | null {
  if (v == null) return null
  const s = v.trim().toLowerCase()
  if (!s) return null
  if (['1', 'true', 't', 'yes', 'y', 'active', 'on'].includes(s)) return true
  if (['0', 'false', 'f', 'no', 'n', 'inactive', 'off'].includes(s)) return false
  return null
}

function personStatus(
  statusValue: string | null,
  inactiveValue: string | null,
): 'active' | 'inactive' | 'terminated' | undefined {
  const s = String(statusValue ?? '')
    .trim()
    .toLowerCase()
  if (['active', 'inactive', 'terminated'].includes(s)) {
    return s as 'active' | 'inactive' | 'terminated'
  }
  if (['term', 'terminated', 'closed'].includes(s)) return 'terminated'
  const inactive = boolish(inactiveValue)
  if (inactive != null) return inactive ? 'inactive' : 'active'
  return undefined
}

function fieldValue(row: Record<string, unknown>, m: EntityMapping, field: string): string | null {
  const templated = m.values?.[field]
  if (templated != null) {
    const rendered = renderTemplate(String(templated), row).trim()
    return rendered === '' ? null : rendered
  }
  return val(row, m.columns?.[field])
}

function cursorKey(entity: SyncEntityKey, m: EntityMapping, index: number): string {
  const label = m.label?.trim() || m.table || m.query?.trim().slice(0, 32) || String(index + 1)
  return `${entity}:${label}`
}

function maxCursorValue(a: unknown, b: unknown): unknown {
  if (a == null) return b
  if (b == null) return a
  const an = typeof a === 'number' ? a : Number(a)
  const bn = typeof b === 'number' ? b : Number(b)
  if (Number.isFinite(an) && Number.isFinite(bn)) return bn > an ? b : a
  const ad = Date.parse(String(a))
  const bd = Date.parse(String(b))
  if (!Number.isNaN(ad) && !Number.isNaN(bd)) return bd > ad ? b : a
  return String(b) > String(a) ? b : a
}

function cursorValue(row: Record<string, unknown>, m: EntityMapping): unknown {
  if (!m.cursorColumn?.trim()) return undefined
  const v = row[m.cursorColumn]
  if (v instanceof Date) return v.toISOString()
  return v == null || v === '' ? undefined : v
}

function externalId(row: Record<string, unknown>, m: EntityMapping, fallback: string): string {
  if (m.externalIdTemplate?.trim()) {
    const rendered = renderTemplate(m.externalIdTemplate, row).trim()
    if (rendered) return rendered
  }
  return (m.idColumn ? val(row, m.idColumn) : null) || fallback
}

function mappingList(mappings: DbConfig['mappings'], entity: SyncEntityKey): EntityMapping[] {
  const raw = mappings?.[entity]
  if (!raw) return []
  const list = Array.isArray(raw) ? raw : [raw]
  return list.filter((m) => Boolean((m.table && m.table.trim()) || (m.query && m.query.trim())))
}

function mapRow(
  entity: SyncEntityKey,
  m: EntityMapping,
  row: Record<string, unknown>,
): CanonicalRecord | null {
  const g = (f: string) => fieldValue(row, m, f)
  switch (entity) {
    case 'people': {
      const fullName = g('fullName')
      const parsed = splitName(fullName)
      const firstName = g('firstName') ?? parsed.first
      const lastName = g('lastName') ?? parsed.last
      const data = {
        fullName,
        firstName,
        lastName,
        employeeNo: g('employeeNo'),
        externalEmployeeId: g('externalEmployeeId'),
        email: g('email'),
        phone: g('phone'),
        jobTitle: g('jobTitle'),
        departmentName: g('departmentName'),
        tradeName: g('tradeName'),
        hireDate: datePart(g('hireDate')),
        status: personStatus(g('status'), g('inactive')),
      }
      if (!data.firstName && !data.lastName) return null
      return {
        entity: 'people',
        externalId: externalId(row, m, data.externalEmployeeId || data.employeeNo || hashRow(row)),
        data,
      }
    }
    case 'org_unit': {
      const address = {
        line1: g('addressLine1') ?? undefined,
        line2: g('addressLine2') ?? undefined,
        city: g('addressCity') ?? undefined,
        region: g('addressRegion') ?? undefined,
        postal: g('addressPostal') ?? undefined,
        country: g('addressCountry') ?? undefined,
      }
      const data = {
        name: g('name') ?? '',
        code: g('code'),
        parentCode: g('parentCode'),
        level: orgLevel(g('level')),
        lat: numPart(g('lat')),
        lng: numPart(g('lng')),
        geofenceMeters: numPart(g('geofenceMeters')),
        address: Object.values(address).some(Boolean) ? address : null,
      }
      if (!data.name) return null
      return {
        entity: 'org_unit',
        externalId: externalId(row, m, data.code || hashRow(row)),
        data,
      }
    }
    case 'equipment': {
      const data = {
        name: g('name') ?? g('assetTag') ?? '',
        assetTag: g('assetTag') ?? '',
        serialNumber: g('serialNumber'),
        typeName: g('typeName'),
      }
      if (!data.assetTag) return null
      return {
        entity: 'equipment',
        externalId: externalId(row, m, data.assetTag || hashRow(row)),
        data,
      }
    }
  }
}

export const databaseConnector: Connector = {
  key: 'database',
  name: 'Database (SQL)',
  description:
    'Connect to any SQL database — PostgreSQL, MySQL/MariaDB or SQL Server. Browse tables, map one or more source tables to People, Locations & Projects, and Equipment, then sync on a schedule.',
  kind: 'native',
  iconKey: 'database',
  entities: ['people', 'org_unit', 'equipment'],
  supportsIntrospection: true,
  configFields: [
    {
      key: 'dbKind',
      label: 'Database type',
      type: 'select',
      required: true,
      options: [
        { value: 'postgres', label: 'PostgreSQL' },
        { value: 'mysql', label: 'MySQL' },
        { value: 'mariadb', label: 'MariaDB' },
        { value: 'mssql', label: 'SQL Server (MSSQL)' },
      ],
    },
    { key: 'host', label: 'Host', type: 'text', required: true, placeholder: 'db.example.com' },
    { key: 'port', label: 'Port', type: 'number', placeholder: '5432 / 3306 / 1433' },
    { key: 'database', label: 'Database', type: 'text', required: true },
    { key: 'username', label: 'Username', type: 'text', required: true },
    { key: 'ssl', label: 'Use SSL/TLS', type: 'boolean' },
  ],
  secretFields: [{ key: 'password', label: 'Password', required: true }],

  async test(ctx) {
    let conn: DbConn | null = null
    try {
      conn = await open(ctx)
      await conn.query('SELECT 1')
      return { ok: true, message: 'Connected successfully.' }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    } finally {
      await conn?.close().catch(() => {})
    }
  },

  async introspect(ctx) {
    const conn = await open(ctx)
    try {
      return { tables: await conn.listTables() }
    } finally {
      await conn.close().catch(() => {})
    }
  },

  async introspectTable(ctx, table) {
    const conn = await open(ctx)
    try {
      return { columns: await conn.listColumns(table) }
    } finally {
      await conn.close().catch(() => {})
    }
  },

  async pull(ctx) {
    const c = cfgOf(ctx)
    const mappings = c.mappings ?? {}
    const entities = (['people', 'org_unit', 'equipment'] as SyncEntityKey[]).filter(
      (e) => mappingList(mappings, e).length > 0,
    )
    if (entities.length === 0) {
      ctx.log('warn', 'No table mappings configured.')
      return []
    }
    const conn = await open(ctx)
    const out: CanonicalRecord[] = []
    const nextCursor: Record<string, unknown> = { ...(ctx.since ?? {}) }
    let hasCursorMapping = false
    let usedCursor = false
    try {
      for (const entity of entities) {
        const entityMappings = mappingList(mappings, entity)
        for (let index = 0; index < entityMappings.length; index++) {
          const m = entityMappings[index]!
          const key = cursorKey(entity, m, index)
          const priorCursor = m.cursorColumn?.trim() ? ctx.since?.[key] : undefined
          if (m.cursorColumn?.trim()) hasCursorMapping = true
          if (priorCursor != null) usedCursor = true
          const q = buildSelect(c.dbKind, m, priorCursor)
          const label = m.label?.trim() || m.table || 'custom query'
          ctx.log('info', `${entity}/${label}: ${q}`)
          const rows = await conn.query(q)
          ctx.log('info', `${entity}/${label}: ${rows.length} row(s)`)
          for (const row of rows) {
            const rec = mapRow(entity, m, row)
            if (rec) out.push(rec)
            const cv = cursorValue(row, m)
            if (cv != null) nextCursor[key] = maxCursorValue(nextCursor[key], cv)
          }
        }
      }
    } finally {
      await conn.close().catch(() => {})
    }
    return {
      records: out,
      nextCursor: hasCursorMapping ? nextCursor : undefined,
      mode: hasCursorMapping && usedCursor ? 'incremental' : 'full',
    }
  },
}
