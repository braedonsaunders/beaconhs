// Read-only reader for deployment-specific landing schemas.
import postgres from 'postgres'

let sql: ReturnType<typeof postgres> | null = null

export function source(): ReturnType<typeof postgres> {
  if (!sql) {
    const url = process.env.ETL_SOURCE_URL
    if (!url) throw new Error('ETL_SOURCE_URL is required')
    sql = postgres(url, { max: 6, prepare: false, onnotice: () => {} })
  }
  return sql
}

const ident = (s: string) => '"' + s.replace(/"/g, '""') + '"'
export const rel = (schema: string, table: string) => `${ident(schema)}.${ident(table)}`

export async function readAll<T = any>(schema: string, table: string, where = ''): Promise<T[]> {
  return (await source().unsafe(`select * from ${rel(schema, table)} ${where}`)) as unknown as T[]
}

export async function count(schema: string, table: string, where = ''): Promise<number> {
  const r = (await source().unsafe(
    `select count(*)::int n from ${rel(schema, table)} ${where}`,
  )) as any[]
  return Number(r[0]?.n ?? 0)
}

/** Keyset-paginated read for large tables (numeric PK, default "id"). */
export async function* readBatches<T = any>(
  schema: string,
  table: string,
  opts: { pk?: string; size?: number; where?: string } = {},
): AsyncGenerator<T[]> {
  const pk = opts.pk ?? 'id'
  const size = opts.size ?? 2000
  const s = source()
  let last: number | null = null
  for (;;) {
    const filt = [opts.where, last == null ? '' : `${ident(pk)} > ${Number(last)}`]
      .filter(Boolean)
      .join(' and ')
    const rows = (await s.unsafe(
      `select * from ${rel(schema, table)} ${filt ? 'where ' + filt : ''} order by ${ident(pk)} asc limit ${size}`,
    )) as any[]
    if (!rows.length) break
    yield rows as T[]
    last = Number(rows[rows.length - 1][pk])
    if (rows.length < size) break
  }
}

export async function distinct<T = any>(
  schema: string,
  table: string,
  col: string,
  where = '',
): Promise<T[]> {
  const r = (await source().unsafe(
    `select distinct ${ident(col)} v from ${rel(schema, table)} ${where} where ${ident(col)} is not null`.replace(
      /\)\s+where/,
      ') where',
    ),
  )) as any[]
  return r.map((x) => x.v)
}

export async function closeSource(): Promise<void> {
  if (sql) {
    await sql.end({ timeout: 5 })
    sql = null
  }
}
