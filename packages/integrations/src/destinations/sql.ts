// SQL insert destination — multi-dialect (PostgreSQL / MySQL / MariaDB / SQL
// Server) via the sync layer's connectDb. Maps each item to one external row
// through a column map; optionally fans each item into one row per ISO week
// (timesheet mode). Idempotent + reversible when an identity column is set:
// the dispatcher hands us the prior external ids, which we delete before
// re-inserting, and we return the new ids for the ledger.

import { connectDb } from '@beaconhs/sync'
import type { DbConn, DbKind } from '@beaconhs/sync'
import { resolveValue } from '../resolve'
import type {
  DeliverContext,
  DeliverRef,
  DeliverResult,
  DestinationDef,
  DestinationTestContext,
  IntegrationResult,
  Item,
  Scalar,
} from '../types'

const DB_KINDS: DbKind[] = ['postgres', 'mysql', 'mariadb', 'mssql']

interface Conn {
  dbKind: DbKind
  host: string
  port?: number
  database: string
  username: string
  ssl: boolean
}

interface Mapping {
  table: string
  idColumn: string
  mode: 'row' | 'weekly'
  columns: Record<string, unknown>
  departmentMap: Map<string, number>
  requireField: string
}

function num(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function parseConn(config: Record<string, unknown>): Conn {
  const raw = String(config.dbKind ?? '').trim() as DbKind
  return {
    dbKind: DB_KINDS.includes(raw) ? raw : 'postgres',
    host: String(config.host ?? '').trim(),
    port: num(config.port),
    database: String(config.database ?? '').trim(),
    username: String(config.username ?? '').trim(),
    ssl: config.ssl === true || config.ssl === 'true',
  }
}

function parseDepartmentMap(raw: unknown): Map<string, number> {
  const map = new Map<string, number>()
  if (typeof raw !== 'string') return map
  for (const line of raw.split(/\r?\n/)) {
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const name = line.slice(0, eq).trim().toLowerCase()
    const id = Number(line.slice(eq + 1).trim())
    if (name && Number.isFinite(id)) map.set(name, id)
  }
  return map
}

function parseColumns(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const p: unknown = JSON.parse(raw)
      if (p && typeof p === 'object' && !Array.isArray(p)) return p as Record<string, unknown>
    } catch {
      /* surfaced by validate */
    }
  }
  return {}
}

function parseMapping(mapping: Record<string, unknown>): Mapping {
  return {
    table: String(mapping.table ?? '').trim(),
    idColumn: String(mapping.idColumn ?? '').trim(),
    mode: mapping.mode === 'weekly' ? 'weekly' : 'row',
    columns: parseColumns(mapping.columns),
    departmentMap: parseDepartmentMap(mapping.departmentMap),
    requireField: String(mapping.requireField ?? '').trim(),
  }
}

function missingConn(c: Conn, password: string): string | null {
  if (!c.host || !c.database || !c.username || !password) {
    return 'Host, database, username and password are required.'
  }
  return null
}

// --- date helpers (UTC) ----------------------------------------------------
function atUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000)
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

interface WeekRow {
  dateStart: string
  dateEnd: string
  dayHours: number[]
}
function buildWeekRows(startsAtIso: string, hoursPerDay: number, lengthDays: number): WeekRow[] {
  const start = atUtcMidnight(new Date(startsAtIso))
  if (Number.isNaN(start.getTime())) return []
  const span = Math.max(1, Math.floor(lengthDays))
  const last = addDays(start, span - 1)
  const rows: WeekRow[] = []
  let weekStart = addDays(start, -start.getUTCDay())
  for (let guard = 0; guard < 60 && weekStart <= last; guard++) {
    const dayHours = [0, 0, 0, 0, 0, 0, 0]
    for (let i = 0; i < 7; i++) {
      const day = addDays(weekStart, i)
      if (day >= start && day <= last) dayHours[i] = hoursPerDay
    }
    if (dayHours.some((h) => h > 0)) {
      rows.push({ dateStart: ymd(weekStart), dateEnd: ymd(addDays(weekStart, 6)), dayHours })
    }
    weekStart = addDays(weekStart, 7)
  }
  return rows
}

// --- dialect SQL emit ------------------------------------------------------
function quoteId(dbKind: DbKind, name: string): string {
  if (dbKind === 'mssql') return `[${name.replace(/]/g, ']]')}]`
  if (dbKind === 'mysql' || dbKind === 'mariadb') return `\`${name.replace(/`/g, '``')}\``
  return `"${name.replace(/"/g, '""')}"`
}
function lit(dbKind: DbKind, v: Scalar): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'boolean') return dbKind === 'postgres' ? (v ? 'TRUE' : 'FALSE') : v ? '1' : '0'
  const s = v.replace(/'/g, "''")
  return dbKind === 'mssql' ? `N'${s}'` : `'${s}'`
}
function firstVal(rows: Record<string, unknown>[]): string | null {
  const row = rows[0]
  if (!row) return null
  const v = Object.values(row)[0]
  return v == null ? null : String(v)
}
async function insertRow(
  conn: DbConn,
  dbKind: DbKind,
  tableQ: string,
  colListQ: string,
  valuesSql: string,
  idColumn: string,
): Promise<string | null> {
  const idQ = quoteId(dbKind, idColumn)
  if (dbKind === 'mssql') {
    return firstVal(
      await conn.query(
        `INSERT INTO ${tableQ} (${colListQ}) OUTPUT INSERTED.${idQ} VALUES (${valuesSql})`,
      ),
    )
  }
  if (dbKind === 'postgres') {
    return firstVal(
      await conn.query(
        `INSERT INTO ${tableQ} (${colListQ}) VALUES (${valuesSql}) RETURNING ${idQ}`,
      ),
    )
  }
  await conn.query(`INSERT INTO ${tableQ} (${colListQ}) VALUES (${valuesSql})`)
  return firstVal(await conn.query('SELECT LAST_INSERT_ID() AS ref'))
}

// --- mapping helpers -------------------------------------------------------
function withDepartment(item: Item, m: Mapping): Item {
  if (!('departmentName' in item)) return item
  const name = item.departmentName
  const dept =
    typeof name === 'string' && name
      ? (m.departmentMap.get(name.trim().toLowerCase()) ?? null)
      : null
  return { ...item, department: dept }
}

function weeklySubItems(item: Item): Item[] {
  const startsAt = item.startsAt
  const hoursPerDay = Number(item.hoursPerDay)
  const lengthDays = Number(item.lengthDays)
  if (
    typeof startsAt !== 'string' ||
    !Number.isFinite(hoursPerDay) ||
    !Number.isFinite(lengthDays)
  ) {
    return [item]
  }
  const weeks = buildWeekRows(startsAt, hoursPerDay, lengthDays)
  if (weeks.length === 0) return [item]
  return weeks.map((wk) => ({
    ...item,
    dateStart: wk.dateStart,
    dateEnd: wk.dateEnd,
    day1Hours: wk.dayHours[0] ?? 0,
    day2Hours: wk.dayHours[1] ?? 0,
    day3Hours: wk.dayHours[2] ?? 0,
    day4Hours: wk.dayHours[3] ?? 0,
    day5Hours: wk.dayHours[4] ?? 0,
    day6Hours: wk.dayHours[5] ?? 0,
    day7Hours: wk.dayHours[6] ?? 0,
    weekHours: wk.dayHours.reduce((s, h) => s + h, 0),
  }))
}

function connect(c: Conn, password: string): Promise<DbConn> {
  return connectDb({
    dbKind: c.dbKind,
    host: c.host,
    port: c.port,
    database: c.database,
    username: c.username,
    password,
    ssl: c.ssl,
  })
}

async function test(ctx: DestinationTestContext): Promise<IntegrationResult> {
  const c = parseConn(ctx.config)
  const password = ctx.secrets.password ?? ''
  const missing = missingConn(c, password)
  if (missing) return { ok: false, error: missing }
  let conn: DbConn | null = null
  try {
    conn = await connect(c, password)
    await conn.query('SELECT 1 AS ok')
    return { ok: true, summary: `Connected to ${c.database} on ${c.host} (${c.dbKind}).` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    if (conn) await conn.close().catch(() => {})
  }
}

async function deliver(ctx: DeliverContext): Promise<DeliverResult> {
  const c = parseConn(ctx.config)
  const password = ctx.secrets.password ?? ''
  const missing = missingConn(c, password)
  if (missing) return { ok: false, error: `Connection is not configured. ${missing}` }
  const m = parseMapping(ctx.mapping)
  if (!m.table) return { ok: false, error: 'No target table configured.' }
  if (!m.idColumn) {
    return {
      ok: false,
      error: 'An identity column is required so retries can reverse completed inserts safely.',
    }
  }
  const colNames = Object.keys(m.columns)
  if (colNames.length === 0) return { ok: false, error: 'No column mapping configured.' }

  const tableQ = quoteId(c.dbKind, m.table)
  const colListQ = colNames.map((col) => quoteId(c.dbKind, col)).join(',')

  const skipped: string[] = []
  const toPost = ctx.items.filter((item) => {
    if (m.requireField && !item[m.requireField]) {
      skipped.push(String(item.fullName ?? item.reference ?? item.personId ?? '?'))
      return false
    }
    return true
  })
  for (const s of skipped) ctx.log('warn', `Skipped (${m.requireField} empty): ${s}`)

  const refs: DeliverRef[] = []
  let conn: DbConn | null = null
  try {
    conn = await connect(c, password)
    if (ctx.priorRefs.length > 0) {
      const inList = ctx.priorRefs.map((r) => (/^\d+$/.test(r) ? r : lit(c.dbKind, r))).join(',')
      await conn.query(
        `DELETE FROM ${tableQ} WHERE ${quoteId(c.dbKind, m.idColumn)} IN (${inList})`,
      )
    }
    for (const baseItem of toPost) {
      const item = withDepartment(baseItem, m)
      const rows = m.mode === 'weekly' ? weeklySubItems(item) : [item]
      for (const row of rows) {
        const valuesSql = colNames
          .map((col) => lit(c.dbKind, resolveValue(m.columns[col], row)))
          .join(',')
        const ref = await insertRow(conn, c.dbKind, tableQ, colListQ, valuesSql, m.idColumn)
        if (!ref)
          throw new Error(`Insert did not return ${m.idColumn}; the row cannot be retried safely.`)
        refs.push({ externalRef: ref, detail: { dateStart: row.dateStart ?? null } })
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), refs }
  } finally {
    if (conn) await conn.close().catch(() => {})
  }

  const skipNote = skipped.length ? ` (${skipped.length} skipped)` : ''
  return {
    ok: true,
    summary: `Inserted ${refs.length} row(s) into ${m.table}${skipNote}.`,
    refs,
  }
}

export const sqlDestination: DestinationDef = {
  key: 'sql',
  name: 'External SQL database',
  description:
    'Insert a row into an external PostgreSQL, MySQL, MariaDB or SQL Server table over verified TLS. Map any columns; optionally one weekly timesheet row per item. An identity column makes every retry reversible.',
  iconKey: 'database',
  mappingKind: 'sql',
  reversible: true,
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
        { value: 'mssql', label: 'SQL Server' },
      ],
    },
    {
      key: 'host',
      label: 'Host',
      type: 'text',
      required: true,
      placeholder: 'db.example.com',
      help: 'Must be a public DNS name. Local, private, and IP-literal hosts are blocked.',
    },
    { key: 'port', label: 'Port', type: 'number', placeholder: 'default for the database type' },
    { key: 'database', label: 'Database', type: 'text', required: true, placeholder: 'payroll' },
    {
      key: 'username',
      label: 'Username',
      type: 'text',
      required: true,
      placeholder: 'service_user',
    },
    {
      key: 'ssl',
      label: 'Encrypt the connection (SSL/TLS)',
      type: 'boolean',
      required: true,
      help: 'Required. The database certificate must be valid for the host name above.',
    },
  ],
  secretFields: [{ key: 'password', label: 'Password', required: true }],
  test,
  deliver,
}
