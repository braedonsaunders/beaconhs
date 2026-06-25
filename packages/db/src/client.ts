import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const DEFAULT_URL = 'postgresql://beaconhs:beaconhs@localhost:5432/beaconhs'

// Runtime application traffic. In production this targets the PgBouncer
// transaction pooler (port 6432). The app role (beaconhs_app) is subject to
// FORCE ROW LEVEL SECURITY, so every tenant-scoped query MUST run inside
// withTenant(), which sets app.tenant_id for the transaction.
const connectionString = process.env.DATABASE_URL ?? DEFAULT_URL

// Cross-tenant / super-admin traffic. Connects as the dedicated BYPASSRLS role
// (beaconhs_super) so the tenant RLS policy can stay a clean, index-usable
// equality with no "OR bypass" branch (the OR defeats the tenant_id index — see
// rls.ts). Falls back to the app pool when unset (local dev convenience); with
// the no-OR policy that fallback CANNOT bypass RLS, so warn loudly in prod.
const superConnectionString = process.env.SUPERADMIN_DATABASE_URL
if (!superConnectionString && process.env.NODE_ENV === 'production') {
  console.warn(
    '[db] SUPERADMIN_DATABASE_URL is not set — super-admin/ETL paths cannot bypass RLS ' +
      'once the no-OR tenant policy is applied. Point it at the beaconhs_super role ' +
      '(PgBouncer 6432).',
  )
}

const queryClient = postgres(connectionString, {
  max: Number(process.env.DATABASE_POOL_MAX ?? 20),
  idle_timeout: 30,
  connect_timeout: 10,
  prepare: false, // required for PgBouncer transaction-mode pooling
})

const superClient = postgres(superConnectionString ?? connectionString, {
  max: Number(process.env.SUPERADMIN_POOL_MAX ?? 10),
  idle_timeout: 30,
  connect_timeout: 10,
  prepare: false,
})

export const db = drizzle(queryClient, { schema })

// Dedicated BYPASSRLS pool used by withSuperAdmin(). Structurally identical to
// `db`; the difference is the connecting role (and therefore RLS behaviour).
export const superDb = drizzle(superClient, { schema })

export type Database = typeof db

// Direct (un-pooled) Postgres connection string for migrations and DDL.
// PgBouncer transaction mode is unsafe for the migration advisory lock and
// session-scoped DDL, so migrate.ts and one-off scripts connect to Postgres
// directly (port 5432) as the table owner (beaconhs_app).
export function directUrl(): string {
  return process.env.DIRECT_DATABASE_URL ?? connectionString
}

export function createClient(opts?: { max?: number; url?: string }) {
  const sql = postgres(opts?.url ?? directUrl(), {
    max: opts?.max ?? 10,
    prepare: false,
  })
  return { db: drizzle(sql, { schema }), sql }
}
