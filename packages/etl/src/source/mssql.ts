// Read-only connector to the legacy MSSQL databases. Pools are cached per source DB.
import sql from 'mssql'
import { mssqlConfig, type SourceDbName } from '../config'

const pools = new Map<SourceDbName, Promise<sql.ConnectionPool>>()

export function pool(db: SourceDbName): Promise<sql.ConnectionPool> {
  let p = pools.get(db)
  if (!p) {
    p = new sql.ConnectionPool(mssqlConfig(db) as sql.config).connect()
    pools.set(db, p)
  }
  return p
}

export async function query<T = any>(db: SourceDbName, q: string): Promise<T[]> {
  const p = await pool(db)
  const r = await p.request().query(q)
  return r.recordset as T[]
}

/** Approximate row count (cheap — from partition stats). */
export async function rowCount(db: SourceDbName, table: string): Promise<number> {
  const r = await query<{ n: number }>(
    db,
    `SELECT SUM(CASE WHEN ps.index_id IN (0,1) THEN ps.row_count ELSE 0 END) AS n
     FROM sys.tables t LEFT JOIN sys.dm_db_partition_stats ps ON ps.object_id=t.object_id
     WHERE t.name = '${table.replace(/'/g, "''")}' GROUP BY t.object_id`,
  )
  return Number(r[0]?.n ?? 0)
}

export async function sample<T = any>(db: SourceDbName, table: string, n = 3): Promise<T[]> {
  return query<T>(db, `SELECT TOP ${Number(n)} * FROM [${table}]`)
}

/**
 * Stream a table in PK-ordered batches (keyset pagination — safe for huge tables).
 * Assumes a single numeric identity PK (true for ~all legacy tables).
 */
export async function* batches<T = any>(
  db: SourceDbName,
  table: string,
  opts: { pk?: string; size?: number; after?: number } = {},
): AsyncGenerator<T[]> {
  const pk = opts.pk ?? 'id'
  const size = opts.size ?? 2000
  const p = await pool(db)
  let last: number | null = opts.after ?? null
  for (;;) {
    const where = last == null ? '' : `WHERE [${pk}] > ${Number(last)}`
    const rows = (
      await p.request().query(`SELECT TOP ${size} * FROM [${table}] ${where} ORDER BY [${pk}] ASC`)
    ).recordset as any[]
    if (!rows.length) break
    yield rows as T[]
    last = Number(rows[rows.length - 1][pk])
    if (rows.length < size) break
  }
}

export async function closeAll(): Promise<void> {
  for (const p of pools.values()) {
    try {
      ;(await p).close()
    } catch {
      /* ignore */
    }
  }
  pools.clear()
  try {
    await (sql as { close?: () => Promise<void> }).close?.()
  } catch {
    /* ignore */
  }
}
