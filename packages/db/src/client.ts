import { drizzle } from 'drizzle-orm/postgres-js'
import { sql, type SQL } from 'drizzle-orm'
import postgres from 'postgres'
import * as schema from './schema'

const DEFAULT_URL = 'postgresql://beaconhs:beaconhs@localhost:5432/beaconhs'

function runtimeDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (value) return value
  if (process.env.NODE_ENV !== 'production') return DEFAULT_URL
  throw new Error('[db] DATABASE_URL is required.')
}

function superAdminDatabaseUrl(): string {
  const value = process.env.SUPERADMIN_DATABASE_URL
  if (value) return value
  if (process.env.NODE_ENV !== 'production') return runtimeDatabaseUrl()
  throw new Error('[db] SUPERADMIN_DATABASE_URL is required.')
}

function poolSize(name: 'DATABASE_POOL_MAX' | 'SUPERADMIN_POOL_MAX', fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`[db] ${name} must be a positive integer.`)
  }
  return value
}

export function assertDatabaseConfiguration(options: { superAdmin?: boolean } = {}): void {
  runtimeDatabaseUrl()
  poolSize('DATABASE_POOL_MAX', 20)
  if (options.superAdmin) {
    superAdminDatabaseUrl()
    poolSize('SUPERADMIN_POOL_MAX', 10)
  }
}

function createDatabase(url: string, max: number) {
  const sql = postgres(url, {
    max,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: false, // required for PgBouncer transaction-mode pooling
  })
  return { db: drizzle(sql, { schema }), sql }
}

export type Database = ReturnType<typeof createDatabase>['db']

/** Normalise Drizzle/postgres-js query results without coupling consumers to
 * either driver's envelope shape. */
export function extractRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[]
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: Record<string, unknown>[] }).rows
  }
  return []
}

/**
 * Convert a compiler-owned PostgreSQL statement (`$1`, `$2`, …) into a
 * Drizzle SQL object without interpolating values into SQL text. This keeps
 * execution on the caller's current transaction, including its tenant RLS
 * settings.
 */
export function parameterizedSql(query: string, parameters: readonly unknown[] = []): SQL {
  const chunks: SQL[] = []
  let cursor = 0
  for (const match of query.matchAll(/\$(\d+)/g)) {
    const offset = match.index
    const parameterIndex = Number(match[1]) - 1
    if (!Number.isSafeInteger(parameterIndex) || parameterIndex < 0) {
      throw new Error(`Invalid SQL parameter placeholder "${match[0]}"`)
    }
    if (parameterIndex >= parameters.length) {
      throw new Error(`SQL parameter ${match[0]} has no bound value`)
    }
    if (offset > cursor) chunks.push(sql.raw(query.slice(cursor, offset)))
    chunks.push(sql`${parameters[parameterIndex]}`)
    cursor = offset + match[0].length
  }
  if (cursor < query.length) chunks.push(sql.raw(query.slice(cursor)))
  if (parameters.length > 0 && chunks.length === 0) {
    throw new Error('SQL parameters were provided but the statement has no placeholders')
  }
  return sql.join(chunks, sql.raw(''))
}

export async function executeParameterizedRows(
  tx: Pick<Database, 'execute'>,
  query: string,
  parameters: readonly unknown[] = [],
): Promise<Record<string, unknown>[]> {
  return extractRows((await tx.execute(parameterizedSql(query, parameters))) as unknown)
}

function lazyDatabase(factory: () => Database): Database {
  let instance: Database | undefined
  const getInstance = () => (instance ??= factory())
  return new Proxy({} as Database, {
    get(_target, property) {
      const database = getInstance()
      const value = Reflect.get(database, property, database) as unknown
      // postgres-js clients are callable functions with helpers such as
      // `.unsafe()` attached as own properties. Function#bind would discard
      // those properties, so expose Drizzle's raw client unchanged.
      if (property === '$client') return value
      return typeof value === 'function' ? value.bind(database) : value
    },
  })
}

// Runtime application traffic. In production this targets the PgBouncer
// transaction pooler (port 6432). The app role (beaconhs_app) is subject to
// FORCE ROW LEVEL SECURITY, so every tenant-scoped query MUST run inside
// withTenant(), which sets app.tenant_id for the transaction. Construction is
// lazy: importing schema/query modules during a Next build must not read
// runtime configuration or materialize a PostgreSQL client.
export const db = lazyDatabase(
  () => createDatabase(runtimeDatabaseUrl(), poolSize('DATABASE_POOL_MAX', 20)).db,
)

// Dedicated BYPASSRLS pool used by withSuperAdmin(). Structurally identical to
// `db`; the difference is the connecting role (and therefore RLS behaviour).
// Local development may share the default URL; production must provide the
// dedicated credential and fails at the first attempted super-admin operation.
export const superDb = lazyDatabase(
  () => createDatabase(superAdminDatabaseUrl(), poolSize('SUPERADMIN_POOL_MAX', 10)).db,
)

export function createClient(opts?: { max?: number; url?: string }) {
  const max = opts?.max ?? 10
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new Error('[db] Client pool max must be a positive integer.')
  }
  return createDatabase(opts?.url ?? runtimeDatabaseUrl(), max)
}

// Client for seed + one-off maintenance scripts that read/write ACROSS tenants.
// Connects as the dedicated BYPASSRLS role (beaconhs_super) — the tenant RLS
// policy is a single `tenant_id = current_setting('app.tenant_id')` equality
// under FORCE ROW LEVEL SECURITY with no bypass-GUC branch (see rls.ts), so
// `set_config('app.bypass_rls','on')` does nothing; only the beaconhs_super role
// bypasses RLS. Prefer SUPERADMIN_DATABASE_URL; fall back to the direct URL for
// local dev, where the default connection may be a superuser.
// If SUPERADMIN_DATABASE_URL is unset against a real DB, cross-tenant writes fail
// the WITH CHECK loudly rather than corrupting data — point it at beaconhs_super.
export function createSuperClient(opts?: { max?: number }) {
  return createClient({
    url: superAdminDatabaseUrl(),
    max: opts?.max,
  })
}
