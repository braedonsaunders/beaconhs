import { drizzle } from 'drizzle-orm/postgres-js'
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
