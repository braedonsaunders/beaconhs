// Thin, uniform adapter over the SQL drivers the database connector supports.
// Drivers are dynamically imported so they're only loaded when actually used
// (and never eagerly bundled). Each adapter exposes the same three operations:
// browse tables, browse columns, run a read query.

import { connect as connectTcp, isIP } from 'node:net'
import type { IntrospectColumn, IntrospectTable } from './types'
import { normalizeOutboundHostname, resolvePublicHost, type ResolvedPublicHost } from './egress'

export type DbKind = 'postgres' | 'mysql' | 'mariadb' | 'mssql'

export interface DbConn {
  listTables(): Promise<IntrospectTable[]>
  listColumns(table: { name: string; schema?: string }): Promise<IntrospectColumn[]>
  query(sql: string): Promise<Record<string, unknown>[]>
  close(): Promise<void>
}

export interface DbConnectConfig {
  dbKind: DbKind
  host: string
  port?: number
  database: string
  username: string
  password: string
  ssl?: boolean
  /** Certificate identity when it differs from `host` (required for IP literals). */
  tlsServerName?: string
  /** Optional pinned CA PEM for a private/self-signed database certificate. */
  tlsCa?: string
}

const DATABASE_HOST_ALLOWLIST_ENV = 'SYNC_DATABASE_HOST_ALLOWLIST'

function parseDatabaseHostAllowlist(raw = process.env[DATABASE_HOST_ALLOWLIST_ENV]): string[] {
  if (!raw?.trim()) return []
  const hosts: string[] = []
  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    hosts.push(normalizeOutboundHostname(trimmed))
  }
  return hosts
}

export function isDatabaseHostAllowlisted(
  host: string,
  raw = process.env[DATABASE_HOST_ALLOWLIST_ENV],
): boolean {
  try {
    return parseDatabaseHostAllowlist(raw).includes(normalizeOutboundHostname(host))
  } catch {
    return false
  }
}

function normalizeTlsServerName(raw: string): string {
  const value = raw.trim()
  if (!value || value.length > 253 || /[\u0000-\u001f\u007f/%\\?#@\s]/.test(value)) {
    throw new Error('TLS certificate host name is not valid.')
  }
  return value
}

function parsePinnedCa(raw: string | undefined): string | undefined {
  if (raw == null) return undefined
  const pem = raw.trim()
  if (!pem) return undefined
  if (!/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(pem)) {
    throw new Error('Pinned CA must be a PEM certificate.')
  }
  return pem
}

const DEFAULT_PORT: Record<DbKind, number> = {
  postgres: 5432,
  mysql: 3306,
  mariadb: 3306,
  mssql: 1433,
}

const CONNECT_TIMEOUT_MS = 15_000
const QUERY_TIMEOUT_MS = 120_000

function connectPinnedTcp(
  resolved: ResolvedPublicHost,
  port: number,
): Promise<ReturnType<typeof connectTcp>> {
  return new Promise((resolve, reject) => {
    const socket = connectTcp({ host: resolved.address, port, family: resolved.family })
    const timer = setTimeout(() => {
      socket.destroy(new Error(`Database connection timed out after ${CONNECT_TIMEOUT_MS} ms.`))
    }, CONNECT_TIMEOUT_MS)
    timer.unref?.()
    socket.once('connect', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

// Escape a value for use inside a single-quoted SQL string literal (used only
// for introspection queries against information_schema with table/schema names).
function esc(s: string): string {
  return s.replace(/'/g, "''")
}

function str(v: unknown): string {
  return v == null ? '' : String(v)
}

function isYes(v: unknown): boolean {
  return str(v).toUpperCase() === 'YES'
}

export async function connectDb(cfg: DbConnectConfig): Promise<DbConn> {
  if (!cfg.host || !cfg.database || !cfg.username) {
    throw new Error('Database connection requires host, database and username.')
  }
  const port = cfg.port ?? DEFAULT_PORT[cfg.dbKind]
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Database port must be an integer between 1 and 65535.')
  }
  if (cfg.ssl !== true) {
    throw new Error('External database connections require SSL/TLS.')
  }
  const allowPrivate = isDatabaseHostAllowlisted(cfg.host)
  const tlsServerName = cfg.tlsServerName?.trim()
    ? normalizeTlsServerName(cfg.tlsServerName)
    : undefined
  const tlsCa = parsePinnedCa(cfg.tlsCa)
  const hostLooksLikeIp = isIP(normalizeOutboundHostname(cfg.host)) !== 0
  if (allowPrivate && hostLooksLikeIp && !tlsServerName) {
    throw new Error('IP-literal database hosts require a TLS certificate host name.')
  }
  const resolved = await resolvePublicHost(cfg.host, {
    timeoutMs: CONNECT_TIMEOUT_MS,
    allowNonPublic: allowPrivate,
  })
  if (resolved.ipLiteral && !allowPrivate) {
    throw new Error(
      'External database host must be a DNS name so its TLS identity can be verified.',
    )
  }
  const normalized = {
    ...cfg,
    host: resolved.hostname,
    port,
    ssl: true,
    tlsServerName,
    tlsCa,
  }
  switch (cfg.dbKind) {
    case 'postgres':
      return connectPostgres(normalized, resolved)
    case 'mysql':
    case 'mariadb':
      return connectMysql(normalized, resolved)
    case 'mssql':
      return connectMssql(normalized, resolved)
    default:
      throw new Error(`Unsupported database type "${String(cfg.dbKind)}".`)
  }
}

// --- PostgreSQL (postgres-js) ---------------------------------------------

interface PgClient {
  unsafe(query: string): Promise<Record<string, unknown>[]>
  end(opts?: { timeout?: number }): Promise<void>
}

async function connectPostgres(
  cfg: DbConnectConfig,
  resolved: ResolvedPublicHost,
): Promise<DbConn> {
  const postgres = (await import('postgres')).default
  const client = postgres({
    host: resolved.address,
    port: cfg.port ?? DEFAULT_PORT.postgres,
    database: cfg.database,
    username: cfg.username,
    password: cfg.password,
    ssl: {
      rejectUnauthorized: true,
      servername: cfg.tlsServerName ?? resolved.hostname,
      ...(cfg.tlsCa ? { ca: cfg.tlsCa } : {}),
    },
    max: 2,
    idle_timeout: 10,
    connect_timeout: CONNECT_TIMEOUT_MS / 1000,
    connection: { statement_timeout: QUERY_TIMEOUT_MS },
    prepare: false,
  }) as unknown as PgClient

  return {
    async query(q) {
      return client.unsafe(q)
    },
    async listTables() {
      const rows = await client.unsafe(
        `select table_schema as schema, table_name as name from information_schema.tables
         where table_type in ('BASE TABLE','VIEW')
           and table_schema not in ('pg_catalog','information_schema')
         order by table_schema, table_name`,
      )
      return rows.map((r) => ({ name: str(r.name), schema: str(r.schema) }))
    },
    async listColumns(table) {
      const where = table.schema ? `and table_schema = '${esc(table.schema)}'` : ''
      const rows = await client.unsafe(
        `select column_name as name, data_type as type, is_nullable as nullable
         from information_schema.columns
         where table_name = '${esc(table.name)}' ${where}
         order by ordinal_position`,
      )
      return rows.map((r) => ({
        name: str(r.name),
        type: str(r.type),
        nullable: isYes(r.nullable),
      }))
    },
    async close() {
      await client.end({ timeout: 5 })
    },
  }
}

// --- MySQL / MariaDB (mysql2) ----------------------------------------------

interface MyConn {
  query(sql: string | { sql: string; timeout: number }): Promise<[unknown, unknown]>
  end(): Promise<void>
}

async function connectMysql(cfg: DbConnectConfig, resolved: ResolvedPublicHost): Promise<DbConn> {
  const mysql = await import('mysql2/promise')
  const port = cfg.port ?? DEFAULT_PORT.mysql
  const conn = (await mysql.createConnection({
    // mysql2 uses config.host for SNI/certificate identity. A supplied stream
    // prevents its own DNS lookup and connects to the already-approved address.
    host: cfg.tlsServerName ?? resolved.hostname,
    port,
    stream: () => connectTcp({ host: resolved.address, port, family: resolved.family }),
    database: cfg.database,
    user: cfg.username,
    password: cfg.password,
    ssl: {
      rejectUnauthorized: true,
      verifyIdentity: true,
      ...(cfg.tlsCa ? { ca: cfg.tlsCa } : {}),
    },
    connectTimeout: CONNECT_TIMEOUT_MS,
    dateStrings: true,
  })) as unknown as MyConn

  const run = async (q: string): Promise<Record<string, unknown>[]> => {
    const [rows] = await conn.query({ sql: q, timeout: QUERY_TIMEOUT_MS })
    return (rows as Record<string, unknown>[]) ?? []
  }

  return {
    query: run,
    async listTables() {
      const rows = await run(
        `select table_schema as \`schema\`, table_name as name from information_schema.tables
         where table_schema = database() order by table_name`,
      )
      return rows.map((r) => ({ name: str(r.name), schema: str(r.schema) }))
    },
    async listColumns(table) {
      const rows = await run(
        `select column_name as name, data_type as type, is_nullable as nullable
         from information_schema.columns
         where table_name = '${esc(table.name)}' and table_schema = database()
         order by ordinal_position`,
      )
      return rows.map((r) => ({
        name: str(r.name),
        type: str(r.type),
        nullable: isYes(r.nullable),
      }))
    },
    async close() {
      await conn.end()
    },
  }
}

// --- SQL Server (mssql / tedious) ------------------------------------------

interface MssqlRequest {
  query(sql: string): Promise<{ recordset: unknown[] }>
}
interface MssqlPool {
  request(): MssqlRequest
  close(): Promise<void>
}
interface MssqlModule {
  ConnectionPool: new (cfg: unknown) => { connect(): Promise<MssqlPool> }
}

async function connectMssql(cfg: DbConnectConfig, resolved: ResolvedPublicHost): Promise<DbConn> {
  // String specifier (not a literal) so consumer programs that compile this
  // file don't need mssql's (absent) type declarations; it resolves from
  // node_modules at runtime.
  const mssqlSpecifier = 'mssql'
  const mod = (await import(mssqlSpecifier)) as { default?: unknown }
  const mssql = (mod.default ?? mod) as unknown as MssqlModule
  const port = cfg.port ?? DEFAULT_PORT.mssql
  const pool = await new mssql.ConnectionPool({
    server: resolved.address,
    port,
    database: cfg.database,
    user: cfg.username,
    password: cfg.password,
    options: {
      encrypt: true,
      trustServerCertificate: false,
      serverName: cfg.tlsServerName ?? resolved.hostname,
      ...(cfg.tlsCa ? { cryptoCredentialsDetails: { ca: cfg.tlsCa } } : {}),
      // Tedious otherwise follows a server-supplied routing target with a fresh
      // unrestricted DNS lookup. Reusing the pinned connector makes such a
      // redirect fail closed instead of turning the SQL protocol into SSRF.
      connector: () => connectPinnedTcp(resolved, port),
    },
    connectionTimeout: CONNECT_TIMEOUT_MS,
    requestTimeout: QUERY_TIMEOUT_MS,
  }).connect()

  const run = async (q: string): Promise<Record<string, unknown>[]> => {
    const r = await pool.request().query(q)
    return (r.recordset as Record<string, unknown>[]) ?? []
  }

  return {
    query: run,
    async listTables() {
      const rows = await run(
        `select TABLE_SCHEMA as [schema], TABLE_NAME as name from INFORMATION_SCHEMA.TABLES
         where TABLE_TYPE in ('BASE TABLE','VIEW') order by TABLE_SCHEMA, TABLE_NAME`,
      )
      return rows.map((r) => ({ name: str(r.name), schema: str(r.schema) }))
    },
    async listColumns(table) {
      const where = table.schema ? `and TABLE_SCHEMA = '${esc(table.schema)}'` : ''
      const rows = await run(
        `select COLUMN_NAME as name, DATA_TYPE as type, IS_NULLABLE as nullable
         from INFORMATION_SCHEMA.COLUMNS
         where TABLE_NAME = '${esc(table.name)}' ${where}
         order by ORDINAL_POSITION`,
      )
      return rows.map((r) => ({
        name: str(r.name),
        type: str(r.type),
        nullable: isYes(r.nullable),
      }))
    },
    async close() {
      await pool.close()
    },
  }
}
