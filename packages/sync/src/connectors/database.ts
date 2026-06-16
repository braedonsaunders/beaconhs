// Generic SQL database connector (native). Connects to PostgreSQL / MySQL /
// MariaDB / SQL Server, can browse tables + columns live (introspection), and
// pulls rows from admin-mapped tables → canonical records. Password is the only
// secret. Incremental cursor is stored for future use; v1 does full pulls
// (idempotent via the crosswalk).

import { createHash } from 'node:crypto'
import { connectDb, type DbConn, type DbKind } from '../db-drivers'
import type { CanonicalRecord, Connector, ConnectorRunContext, SyncEntityKey } from '../types'

interface EntityMapping {
  table: string
  schema?: string
  where?: string
  idColumn?: string
  cursorColumn?: string
  columns: Record<string, string> // canonical field → source column
}

interface DbConfig {
  dbKind: DbKind
  host: string
  port?: number
  database: string
  username: string
  ssl?: boolean
  mappings?: Partial<Record<SyncEntityKey, EntityMapping>>
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

function buildSelect(kind: DbKind, m: EntityMapping): string {
  const target = m.schema ? `${qid(kind, m.schema)}.${qid(kind, m.table)}` : qid(kind, m.table)
  let q = `SELECT * FROM ${target}`
  if (m.where && m.where.trim()) q += ` WHERE ${m.where.trim()}`
  return q
}

function val(row: Record<string, unknown>, col: string | undefined | null): string | null {
  if (!col) return null
  const v = row[col]
  if (v == null) return null
  if (v instanceof Date) return v.toISOString()
  const s = String(v)
  return s === '' ? null : s
}

function datePart(v: string | null): string | null {
  if (!v) return null
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) return m[1] ?? null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10)
}

function hashRow(o: unknown): string {
  return createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16)
}

function mapRow(
  entity: SyncEntityKey,
  m: EntityMapping,
  row: Record<string, unknown>,
): CanonicalRecord | null {
  const cols = m.columns ?? {}
  const g = (f: string) => val(row, cols[f])
  const idRaw = m.idColumn ? val(row, m.idColumn) : null
  switch (entity) {
    case 'people': {
      const data = {
        firstName: g('firstName') ?? '',
        lastName: g('lastName') ?? '',
        employeeNo: g('employeeNo'),
        email: g('email'),
        phone: g('phone'),
        jobTitle: g('jobTitle'),
        departmentName: g('departmentName'),
        tradeName: g('tradeName'),
        hireDate: datePart(g('hireDate')),
      }
      if (!data.firstName && !data.lastName) return null
      return { entity: 'people', externalId: idRaw || data.employeeNo || hashRow(row), data }
    }
    case 'org_unit': {
      const data = {
        name: g('name') ?? '',
        code: g('code'),
        parentCode: g('parentCode'),
      }
      if (!data.name) return null
      return { entity: 'org_unit', externalId: idRaw || data.code || hashRow(row), data }
    }
    case 'equipment': {
      const data = {
        name: g('name') ?? g('assetTag') ?? '',
        assetTag: g('assetTag') ?? '',
        serialNumber: g('serialNumber'),
        typeName: g('typeName'),
      }
      if (!data.assetTag) return null
      return { entity: 'equipment', externalId: idRaw || data.assetTag || hashRow(row), data }
    }
  }
}

export const databaseConnector: Connector = {
  key: 'database',
  name: 'Database (SQL)',
  description:
    'Connect to any SQL database — PostgreSQL, MySQL/MariaDB or SQL Server. Browse tables, map columns to People, Locations and Equipment, and sync on a schedule.',
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
    const entities = (Object.keys(mappings) as SyncEntityKey[]).filter((e) => mappings[e]?.table)
    if (entities.length === 0) {
      ctx.log('warn', 'No table mappings configured.')
      return []
    }
    const conn = await open(ctx)
    const out: CanonicalRecord[] = []
    try {
      for (const entity of entities) {
        const m = mappings[entity]
        if (!m || !m.table) continue
        const q = buildSelect(c.dbKind, m)
        ctx.log('info', `${entity}: ${q}`)
        const rows = await conn.query(q)
        ctx.log('info', `${entity}: ${rows.length} row(s) from ${m.table}`)
        for (const row of rows) {
          const rec = mapRow(entity, m, row)
          if (rec) out.push(rec)
        }
      }
    } finally {
      await conn.close().catch(() => {})
    }
    return out
  },
}
