// Generic ETL configuration. Concrete source-system names and tenant mappings
// should come from environment variables or private adapters, not public source.

export type SourceDbName = string

export const SOURCE_DBS: SourceDbName[] = (process.env.ETL_SOURCE_DBS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

export const TENANT_SLUG_BY_DB: Record<string, string> = parseTenantMap(
  process.env.ETL_TENANT_SLUG_BY_DB,
)

function parseTenantMap(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(Object.entries(parsed).map(([db, slug]) => [db, String(slug)]))
    }
  } catch {
    // Fall through to comma syntax.
  }

  return Object.fromEntries(
    raw
      .split(',')
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const [db, slug] = pair.split(':', 2)
        if (!db || !slug) throw new Error('ETL_TENANT_SLUG_BY_DB must be JSON or db:slug pairs')
        return [db.trim(), slug.trim()]
      }),
  )
}

function env(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback
  if (v == null || v === '') throw new Error(`Missing required env var ${key}`)
  return v
}

/** Optional MSSQL connection config for private migration adapters. */
export function mssqlConfig(database: SourceDbName) {
  return {
    server: env('ETL_MSSQL_HOST'),
    port: Number(env('ETL_MSSQL_PORT', '1433')),
    user: env('ETL_MSSQL_USER'),
    password: env('ETL_MSSQL_PASSWORD'),
    database,
    options: {
      encrypt: process.env.ETL_MSSQL_ENCRYPT === 'true',
      trustServerCertificate: process.env.ETL_MSSQL_TRUST_CERT !== 'false',
      enableArithAbort: true,
    },
    requestTimeout: Number(process.env.ETL_MSSQL_REQUEST_TIMEOUT_MS ?? 180000),
    connectionTimeout: Number(process.env.ETL_MSSQL_CONNECT_TIMEOUT_MS ?? 20000),
    pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
  }
}

/** Target Postgres connection string. */
export function targetUrl(): string {
  return env('DATABASE_URL')
}
