// Import/sync engine. Runs deployment-provided loaders in dependency order.
// Each loader reads a landing table, maps each row to a target row (remapping
// FKs via the etl.id_map crosswalk), and upserts in batches under
// withSuperAdmin (RLS bypass). The crosswalk reserve + target upsert share one
// transaction per batch, so a re-run is idempotent.
import { randomUUID, createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { createClient, withSuperAdmin } from '@beaconhs/db'
import { ensureEtlSchema, startRun, finishRun } from './crosswalk'
import { targetUrl } from './config'
import * as landing from './source/landing'

// ---------- coercion helpers (shared by mappers) ----------
export const H = {
  str: (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim()),
  bool: (v: unknown): boolean => /^(1|y|yes|true|active|t|on)$/i.test(String(v ?? '').trim()),
  num: (v: unknown): number | null =>
    v == null || v === '' || isNaN(Number(v)) ? null : Number(v),
  int: (v: unknown): number | null =>
    v == null || v === '' || isNaN(Number(v)) ? null : Math.trunc(Number(v)),
  // Source datetimes may arrive as Date objects or strings.
  ts: (v: unknown): Date | null => {
    if (v == null || v === '') return null
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v
    const d = new Date(
      String(v)
        .trim()
        .replace(/:(AM|PM)\s*$/i, ' $1'),
    )
    return isNaN(d.getTime()) ? null : d
  },
  date: (v: unknown): string | null => {
    const d = H.ts(v)
    return d ? d.toISOString().slice(0, 10) : null
  },
  // split "Last, First" or "First Last" into {first,last}
  name: (full: unknown): { first: string; last: string } => {
    const s = String(full ?? '').trim()
    if (!s) return { first: '', last: '' }
    if (s.includes(',')) {
      const [last, first] = s.split(',', 2)
      return { first: (first ?? '').trim(), last: (last ?? '').trim() }
    }
    const parts = s.split(/\s+/)
    return {
      first: parts.slice(0, -1).join(' ') || parts[0]!,
      last: parts.length > 1 ? parts[parts.length - 1]! : '',
    }
  },
  // delimited "a, b\nc" -> ['a','b','c'] (also accepts JSON arrays)
  list: (v: unknown): string[] => {
    const s = String(v ?? '').trim()
    if (!s) return []
    if (s.startsWith('[')) {
      try {
        const a = JSON.parse(s)
        if (Array.isArray(a)) return a.map(String)
      } catch {
        /* fall through */
      }
    }
    return s
      .split(/[\n,;|]+/)
      .map((x) => x.trim())
      .filter(Boolean)
  },
}

export function rowHash(row: Record<string, unknown>): string {
  const o: Record<string, unknown> = {}
  for (const k of Object.keys(row).sort())
    if (k !== 'created_at' && k !== 'updated_at') o[k] = row[k]
  return createHash('sha1').update(JSON.stringify(o)).digest('hex')
}

// ---------- loader contract ----------
export type Ctx = {
  tenantId: string
  tx: any
  lookup: (srcSchema: string, srcTable: string, srcPk: unknown) => Promise<string | null>
  /** value returned by the loader's optional prepare() hook (e.g. a name→id map) */
  prepared?: any
}

export type Loader = {
  entity: string
  srcSchema: string
  srcTable: string
  tenant: string
  target: any
  pk?: string
  batch?: number
  where?: string
  /** runs once before the row loop; its result is passed to map() via ctx.prepared */
  prepare?: (env: Env, tenantId: string) => Promise<unknown>
  map: (
    row: any,
    ctx: Ctx,
  ) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null
  /** custom loaders bypass the generic row loop (e.g. EAV pivots) */
  custom?: (env: Env, tenantId: string) => Promise<{ source: number; upserted: number }>
}

type Env = {
  db: ReturnType<typeof createClient>['db']
  tsql: ReturnType<typeof createClient>['sql']
  tenantIdBySlug: Record<string, string>
  cache: Map<string, string>
}

const cacheKey = (s: string, t: string, pk: unknown) => `${s}.${t}.${pk}`

async function reserve(
  env: Env,
  tx: any,
  srcSchema: string,
  srcTable: string,
  srcPk: unknown,
  entity: string,
  tenantId: string,
  rh: string,
): Promise<string> {
  const ck = cacheKey(srcSchema, srcTable, srcPk)
  const newId = randomUUID()
  const r: any = await tx.execute(sql`
    insert into etl.id_map (source_db, source_table, source_pk, entity_type, tenant_id, new_id, row_hash)
    values (${srcSchema}, ${srcTable}, ${String(srcPk)}, ${entity}, ${tenantId}::uuid, ${newId}::uuid, ${rh})
    on conflict (source_db, source_table, source_pk)
      do update set row_hash = excluded.row_hash, last_synced_at = now()
    returning new_id`)
  const id = (r.rows ?? r)[0].new_id as string
  env.cache.set(ck, id)
  return id
}

// Batched crosswalk reserve: one round-trip for a whole page of rows (the per-row variant above is
// kept for custom loaders). Returns Map<sourcePk, newId> and warms the FK cache.
async function reserveBatch(
  env: Env,
  tx: any,
  srcSchema: string,
  srcTable: string,
  entity: string,
  tenantId: string,
  items: { pk: unknown; rh: string }[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (!items.length) return map
  const rowsSql = items.map(
    (it) =>
      sql`(${srcSchema}, ${srcTable}, ${String(it.pk)}, ${entity}, ${tenantId}::uuid, ${randomUUID()}::uuid, ${it.rh})`,
  )
  const res: any = await tx.execute(sql`
    insert into etl.id_map (source_db, source_table, source_pk, entity_type, tenant_id, new_id, row_hash)
    values ${sql.join(rowsSql, sql`, `)}
    on conflict (source_db, source_table, source_pk)
      do update set row_hash = excluded.row_hash, last_synced_at = now()
    returning source_pk, new_id`)
  for (const r of res.rows ?? res) {
    map.set(String(r.source_pk), r.new_id)
    env.cache.set(cacheKey(srcSchema, srcTable, r.source_pk), r.new_id)
  }
  return map
}

function makeLookup(env: Env, tx: any) {
  return async (srcSchema: string, srcTable: string, srcPk: unknown): Promise<string | null> => {
    if (srcPk == null || srcPk === '' || srcPk === 0 || srcPk === '0') return null
    const ck = cacheKey(srcSchema, srcTable, srcPk)
    const hit = env.cache.get(ck)
    if (hit) return hit
    const r: any = await tx.execute(sql`
      select new_id from etl.id_map
      where source_db=${srcSchema} and source_table=${srcTable} and source_pk=${String(srcPk)} limit 1`)
    const id = (r.rows ?? r)[0]?.new_id ?? null
    if (id) env.cache.set(ck, id)
    return id
  }
}

function buildUpsertSet(target: any, sampleKeys: string[]) {
  const set: Record<string, unknown> = {}
  for (const k of sampleKeys) {
    if (k === 'id') continue
    const col = target[k]
    if (!col?.name) continue
    set[k] = sql.raw(`excluded."${col.name}"`)
  }
  return set
}

async function getWatermark(env: Env, sd: string, st: string): Promise<string | null> {
  const r: any =
    await env.tsql`select watermark_value from etl.table_watermarks where source_db=${sd} and source_table=${st}`
  return r[0]?.watermark_value ?? null
}
async function setWatermark(env: Env, sd: string, st: string, val: string | null): Promise<void> {
  if (!val) return
  await env.tsql`insert into etl.table_watermarks (source_db, source_table, watermark_value) values (${sd}, ${st}, ${val})
    on conflict (source_db, source_table) do update set watermark_value=${val}, updated_at=now()`
}

export type Mode = 'import' | 'sync'

async function runGeneric(
  env: Env,
  loader: Loader,
  mode: Mode,
): Promise<{ source: number; upserted: number }> {
  const tenantId = env.tenantIdBySlug[loader.tenant]
  if (!tenantId) throw new Error(`No tenant found for loader tenant slug "${loader.tenant}"`)
  const pk = loader.pk ?? 'id'
  // Both import and sync read from the configured landing schema. Sync uses
  // updated_at > watermark when the source table exposes that convention.
  const readSchema = loader.srcSchema
  const wm = mode === 'sync' ? await getWatermark(env, loader.srcSchema, loader.srcTable) : null
  const where = [loader.where, wm ? `"updated_at" > '${wm.replace(/'/g, "''")}'` : '']
    .filter(Boolean)
    .join(' and ')
  let source = 0
  let upserted = 0
  let maxU: string | null = wm
  const prepared = loader.prepare ? await loader.prepare(env, tenantId) : undefined
  for await (const rows of landing.readBatches(readSchema, loader.srcTable, {
    pk,
    size: loader.batch ?? 1000,
    where,
  })) {
    await withSuperAdmin(env.db, async (tx) => {
      const lookup = makeLookup(env, tx)
      source += rows.length
      // Map FIRST (so we know which rows survive), then reserve crosswalk ids only for the survivors.
      // Reserving for skipped rows would leave phantom id_map entries → child FK lookups resolve to
      // non-existent parents → FK violations.
      const mapped: { pk: unknown; rh: string; vals: Record<string, unknown> }[] = []
      for (const row of rows) {
        const u = H.ts((row as any).updated_at)
        if (u) {
          const iso = u.toISOString()
          if (!maxU || iso > maxU) maxU = iso
        }
        const vals = await loader.map(row, { tenantId, tx, lookup, prepared })
        if (vals) mapped.push({ pk: row[pk], rh: rowHash(row), vals })
      }
      if (mapped.length) {
        const idMap = await reserveBatch(
          env,
          tx,
          loader.srcSchema,
          loader.srcTable,
          loader.entity,
          tenantId,
          mapped.map((m) => ({ pk: m.pk, rh: m.rh })),
        )
        const out = mapped.map((m) => ({ id: idMap.get(String(m.pk)), tenantId, ...m.vals }))
        await tx
          .insert(loader.target)
          .values(out)
          .onConflictDoUpdate({
            target: loader.target.id,
            set: buildUpsertSet(loader.target, Object.keys(out[0]!)),
          })
        upserted += out.length
      }
    })
  }
  // advance the watermark (so the next sync only sees newer rows). On import this primes it.
  await setWatermark(env, loader.srcSchema, loader.srcTable, maxU)
  return { source, upserted }
}

export async function runImport(
  loaders: Loader[],
  opts: { only?: string; mode?: Mode } = {},
): Promise<{ entity: string; source: number; upserted: number }[]> {
  const mode: Mode = opts.mode ?? 'import'
  const { db, sql: tsql } = createClient({ url: targetUrl() })
  await ensureEtlSchema(tsql as any)
  const tRows: any[] = await tsql`select slug, id from tenants`
  const tenantIdBySlug: Record<string, string> = {}
  for (const r of tRows) tenantIdBySlug[r.slug] = r.id
  const env: Env = { db, tsql, tenantIdBySlug, cache: new Map() }

  const stats: { entity: string; source: number; upserted: number }[] = []
  const runId = await startRun(tsql as any, mode)
  console.log(`\n${mode} (run ${runId}) → tenants: ${Object.keys(tenantIdBySlug).join(', ')}\n`)
  try {
    for (const loader of loaders) {
      if (opts.only && loader.entity !== opts.only) continue
      process.stdout.write(`  ${loader.entity.padEnd(28)} `)
      const t0 = Date.now()
      const tenantId = env.tenantIdBySlug[loader.tenant]
      if (!tenantId) throw new Error(`No tenant found for loader tenant slug "${loader.tenant}"`)
      const r = loader.custom
        ? await loader.custom(env, tenantId)
        : await runGeneric(env, loader, mode)
      stats.push({ entity: loader.entity, ...r })
      console.log(
        `src=${r.source} upserted=${r.upserted} (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
      )
    }
    console.log('\n=== reconciliation ===')
    console.table(stats)
    await finishRun(tsql as any, runId, 'ok', {
      mode,
      totalUpserted: stats.reduce((a, s) => a + s.upserted, 0),
      entities: stats,
    })
  } catch (e) {
    await finishRun(
      tsql as any,
      runId,
      'failed',
      { mode, entities: stats },
      e instanceof Error ? e.message : String(e),
    )
    throw e
  } finally {
    await tsql.end({ timeout: 5 })
    await landing.closeSource()
  }
  return stats
}

// expose internals used by custom loaders
export const internals = { reserve, makeLookup, buildUpsertSet, runGeneric }
export type { Env }
