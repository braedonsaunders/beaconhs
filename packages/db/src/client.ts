import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://beaconhs:beaconhs@localhost:5432/beaconhs'

// Long-lived shared connection for the app process.
// Workers and migration scripts should call createClient() with their own pool config.
const queryClient = postgres(connectionString, {
  max: Number(process.env.DATABASE_POOL_MAX ?? 20),
  idle_timeout: 30,
  connect_timeout: 10,
  prepare: false,
})

export const db = drizzle(queryClient, { schema })

export type Database = typeof db

export function createClient(opts?: { max?: number; url?: string }) {
  const sql = postgres(opts?.url ?? connectionString, {
    max: opts?.max ?? 10,
    prepare: false,
  })
  return { db: drizzle(sql, { schema }), sql }
}
