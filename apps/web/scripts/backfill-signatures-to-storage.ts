/**
 * One-time backfill: move inline base64 signature blobs out of Postgres and into
 * object storage (MinIO/R2), replacing each column value with a stable public URL.
 *
 * Idempotent + resumable: only touches rows whose value still starts with `data:`,
 * so it can be re-run safely and stops when nothing is left. Reads/writes across all
 * tenants via the BYPASSRLS super role (the tenant RLS policy no longer has a GUC
 * bypass branch). Uploads are concurrency-limited to spare MinIO.
 *
 * Run: pnpm --filter @beaconhs/web exec tsx scripts/backfill-signatures-to-storage.ts
 *   (needs SUPERADMIN_DATABASE_URL + R2_* in env)
 */
import { newAttachmentKey, publicUrl, putObject } from '@beaconhs/storage'
import { createClient } from '@beaconhs/db'

const url = process.env.SUPERADMIN_DATABASE_URL
if (!url) {
  console.error('SUPERADMIN_DATABASE_URL is required (backfill bypasses RLS via beaconhs_super)')
  process.exit(1)
}

// Every signature column to migrate. All these tables carry tenant_id.
const TARGETS = [
  { table: 'hazid_assessment_signatures', col: 'signature_data_url' },
  { table: 'inspection_records', col: 'customer_signature_data_url' },
  { table: 'form_response_steps', col: 'signature_data_url' },
  { table: 'flow_gates', col: 'signature_data_url' },
  { table: 'training_lesson_progress', col: 'evaluation_signature_data_url' },
  { table: 'job_title_task_acknowledgments', col: 'signature_data_url' },
  { table: 'ca_complete_steps', col: 'signature_data_url' },
] as const

const BATCH = 100
const UPLOAD_CONCURRENCY = 16
const DATA_URL_RE = /^data:([^;,]+)(?:;[^,]*)?,(.*)$/s

const { sql } = createClient({ url, max: 4 })

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++
        out[idx] = await fn(items[idx]!)
      }
    }),
  )
  return out
}

async function uploadOne(tenantId: string, dataUrl: string): Promise<string | null> {
  const m = DATA_URL_RE.exec(dataUrl)
  if (!m) return null
  const contentType = m[1] || 'image/png'
  const body = Buffer.from(m[2] ?? '', 'base64')
  if (body.length === 0) return null
  const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png'
  const key = newAttachmentKey({ tenantId, kind: 'signature', filename: `signature.${ext}` })
  await putObject({ key, body, contentType })
  return publicUrl(key)
}

async function backfillTable(
  table: string,
  col: string,
): Promise<{ migrated: number; skipped: number }> {
  let migrated = 0
  let skipped = 0
  let consecutiveErrors = 0
  // Resilient to the cluster's intermittent VPN flap: a dropped/timed-out batch
  // is retried (postgres.js reconnects on the next query) up to 5 times with
  // backoff before giving up. The work is idempotent, so a retried batch is safe.
  for (;;) {
    try {
      const rows = await sql.unsafe(
        `SELECT id::text AS id, tenant_id::text AS tenant_id, ${col} AS val
         FROM ${table} WHERE ${col} LIKE 'data:%' LIMIT ${BATCH}`,
      )
      if (rows.length === 0) break

      const results = await mapLimit(
        rows as unknown as { id: string; tenant_id: string; val: string }[],
        UPLOAD_CONCURRENCY,
        async (r) => {
          if (!r.tenant_id) return { id: r.id, urlOrNull: null as string | null }
          try {
            return { id: r.id, urlOrNull: await uploadOne(r.tenant_id, r.val) }
          } catch (e) {
            console.warn(`  upload failed for ${table} ${r.id}: ${(e as Error).message}`)
            return { id: r.id, urlOrNull: null as string | null }
          }
        },
      )

      await sql.begin(async (tx) => {
        for (const res of results) {
          if (res.urlOrNull) {
            await tx.unsafe(`UPDATE ${table} SET ${col} = $1 WHERE id = $2::uuid`, [
              res.urlOrNull,
              res.id,
            ])
            migrated++
          } else {
            // undecodable / empty payload — null it out so the loop terminates.
            await tx.unsafe(`UPDATE ${table} SET ${col} = NULL WHERE id = $1::uuid`, [res.id])
            skipped++
          }
        }
      })
      consecutiveErrors = 0
      process.stdout.write(`\r  ${table}: ${migrated} migrated, ${skipped} skipped`)
    } catch (e) {
      consecutiveErrors++
      process.stdout.write(
        `\n  ${table}: batch error ${consecutiveErrors}/5 (${(e as Error).message}) — retrying…\n`,
      )
      if (consecutiveErrors >= 5) throw e
      await new Promise((resolve) => setTimeout(resolve, 2000 * consecutiveErrors))
    }
  }
  if (migrated + skipped > 0) process.stdout.write('\n')
  return { migrated, skipped }
}

async function main() {
  console.log('▶ Backfilling inline signatures → object storage')
  let totalMigrated = 0
  for (const t of TARGETS) {
    const { migrated, skipped } = await backfillTable(t.table, t.col)
    if (migrated + skipped === 0) console.log(`  ${t.table}.${t.col}: nothing to migrate`)
    totalMigrated += migrated
  }
  console.log(`✔ Done — ${totalMigrated} signatures moved to object storage`)
  await sql.end({ timeout: 5 })
}

main().catch((e) => {
  console.error('BACKFILL FAILED:', (e as Error).message)
  process.exit(1)
})
