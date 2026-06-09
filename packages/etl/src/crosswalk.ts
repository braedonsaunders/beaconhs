// The identity crosswalk + run bookkeeping, backed by the `etl` Postgres schema.
// Uses a raw `postgres` connection (porsager) so it can run outside Drizzle/RLS.
import postgres from 'postgres'
import { createHash, randomUUID } from 'node:crypto'
import { ETL_SCHEMA_SQL } from './etl-schema'
import { targetUrl } from './config'

export type Pg = ReturnType<typeof postgres>

export function connect(url: string = targetUrl()): Pg {
  return postgres(url, { max: 8, prepare: false, onnotice: () => {} })
}

export async function ensureEtlSchema(sql: Pg): Promise<void> {
  await sql.unsafe(ETL_SCHEMA_SQL)
}

/** Stable content hash of a source row (excluding volatile keys) for change-detection. */
export function rowHash(row: Record<string, unknown>): string {
  const copy: Record<string, unknown> = {}
  for (const k of Object.keys(row).sort()) {
    if (k === 'created_at' || k === 'updated_at') continue
    copy[k] = row[k]
  }
  return createHash('sha1').update(JSON.stringify(copy)).digest('hex')
}

export async function lookupId(
  sql: Pg,
  sourceDb: string,
  sourceTable: string,
  sourcePk: string | number,
): Promise<string | null> {
  const r = await sql<{ new_id: string }[]>`
    select new_id from etl.id_map
    where source_db=${sourceDb} and source_table=${sourceTable} and source_pk=${String(sourcePk)}`
  return r[0]?.new_id ?? null
}

/**
 * Reserve (or fetch) the new uuid for a legacy row. Returns { id, isNew, changed }.
 * `changed` is true when the row_hash differs from what we last saw (drives upserts on sync).
 */
export async function mapId(
  sql: Pg,
  args: {
    sourceDb: string
    sourceTable: string
    sourcePk: string | number
    entityType: string
    tenantId: string
    rowHash?: string
  },
): Promise<{ id: string; isNew: boolean; changed: boolean }> {
  const existing = await sql<{ new_id: string; row_hash: string | null }[]>`
    select new_id, row_hash from etl.id_map
    where source_db=${args.sourceDb} and source_table=${args.sourceTable} and source_pk=${String(args.sourcePk)}`
  if (existing[0]) {
    const changed = args.rowHash != null && existing[0].row_hash !== args.rowHash
    if (changed) {
      await sql`update etl.id_map set row_hash=${args.rowHash ?? null}, last_synced_at=now()
        where source_db=${args.sourceDb} and source_table=${args.sourceTable} and source_pk=${String(args.sourcePk)}`
    }
    return { id: existing[0].new_id, isNew: false, changed }
  }
  const id = randomUUID()
  await sql`insert into etl.id_map (source_db, source_table, source_pk, entity_type, tenant_id, new_id, row_hash)
    values (${args.sourceDb}, ${args.sourceTable}, ${String(args.sourcePk)}, ${args.entityType}, ${args.tenantId}, ${id}, ${args.rowHash ?? null})
    on conflict (source_db, source_table, source_pk) do nothing`
  return { id, isNew: true, changed: true }
}

export async function startRun(sql: Pg, mode: string): Promise<string> {
  const r = await sql<{ id: string }[]>`insert into etl.sync_runs (mode) values (${mode}) returning id`
  return r[0]!.id
}

export async function finishRun(
  sql: Pg,
  runId: string,
  status: 'ok' | 'failed',
  stats: Record<string, unknown>,
  error?: string,
): Promise<void> {
  await sql`update etl.sync_runs set finished_at=now(), status=${status}, stats=${JSON.stringify(stats)}::jsonb, error=${error ?? null} where id=${runId}::uuid`
}
