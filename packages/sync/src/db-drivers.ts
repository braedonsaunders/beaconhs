// Thin, uniform adapter over the SQL drivers the database connector supports.
// Drivers are dynamically imported so they're only loaded when actually used
// (and never eagerly bundled). Each adapter exposes the same three operations:
// browse tables, browse columns, run a read query.

import type { IntrospectColumn, IntrospectTable } from './types'

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
}

const DEFAULT_PORT: Record<DbKind, number> = {
  postgres: 5432,
  mysql: 3306,
  mariadb: 3306,
  mssql: 1433,
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
  switch (cfg.dbKind) {
    case 'postgres':
      return connectPostgres(cfg)
    case 'mysql':
    case 'mariadb':
      return connectMysql(cfg)
    case 'mssql':
      return connectMssql(cfg)
    default:
      throw new Error(`Unsupported database type "${String(cfg.dbKind)}".`)
  }
}

// --- PostgreSQL (postgres-js) ---------------------------------------------

interface PgClient {
  unsafe(query: string): Promise<Record<string, unknown>[]>
  end(opts?: { timeout?: number }): Promise<void>
}

async function connectPostgres(cfg: DbConnectConfig): Promise<DbConn> {
  const postgres = (await import('postgres')).default
  const client = postgres({
    host: cfg.host,
    port: cfg.port ?? DEFAULT_PORT.postgres,
    database: cfg.database,
    username: cfg.username,
    password: cfg.password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
    max: 2,
    idle_timeout: 10,
    connect_timeout: 15,
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
  query(sql: string): Promise<[unknown, unknown]>
  end(): Promise<void>
}

async function connectMysql(cfg: DbConnectConfig): Promise<DbConn> {
  const mysql = await import('mysql2/promise')
  const conn = (await mysql.createConnection({
    host: cfg.host,
    port: cfg.port ?? DEFAULT_PORT.mysql,
    database: cfg.database,
    user: cfg.username,
    password: cfg.password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    connectTimeout: 15000,
    dateStrings: true,
  })) as unknown as MyConn

  const run = async (q: string): Promise<Record<string, unknown>[]> => {
    const [rows] = await conn.query(q)
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

async function connectMssql(cfg: DbConnectConfig): Promise<DbConn> {
  // String specifier (not a literal) so consumer programs that compile this
  // file don't need mssql's (absent) type declarations; it resolves from
  // node_modules at runtime.
  const mssqlSpecifier = 'mssql'
  const mod = (await import(mssqlSpecifier)) as { default?: unknown }
  const mssql = (mod.default ?? mod) as unknown as MssqlModule
  const pool = await new mssql.ConnectionPool({
    server: cfg.host,
    port: cfg.port ?? DEFAULT_PORT.mssql,
    database: cfg.database,
    user: cfg.username,
    password: cfg.password,
    options: { encrypt: !!cfg.ssl, trustServerCertificate: true },
    connectionTimeout: 15000,
    requestTimeout: 120000,
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
