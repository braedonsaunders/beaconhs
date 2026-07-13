/**
 * One-time clean-cutover migration from legacy signature text columns to
 * attachment foreign keys.
 *
 * Safety defaults:
 *   pnpm --filter @beaconhs/web exec tsx scripts/backfill-signatures-to-storage.ts
 *     audits/decodes every value and writes nothing.
 *
 * Apply only after the additive migration has created every `newColumn`:
 *   ... backfill-signatures-to-storage.ts --apply
 *
 * The apply pass holds a cluster advisory lock, uses deterministic keys so a
 * killed process resumes without duplicating objects, verifies stored bytes by
 * size/type/SHA-256, atomically inserts+links each attachment, nulls the legacy
 * value, compensates failed DB writes, then asserts zero legacy values remain.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { createClient } from '@beaconhs/db'
import { BUCKET, deleteObject, getObject, headObject, putObject } from '@beaconhs/storage'

const DATABASE_URL = process.env.SUPERADMIN_DATABASE_URL
if (!DATABASE_URL) throw new Error('SUPERADMIN_DATABASE_URL is required')

const APPLY = process.argv.includes('--apply')
const BATCH_SIZE = 250
const CONCURRENCY = 8
const MAX_SIGNATURE_BYTES = 10 * 1024 * 1024
const LOCK_NAME = 'beaconhs:signature-attachment-cutover:v1'

const TARGETS = [
  {
    table: 'hazid_assessment_signatures',
    legacyColumn: 'signature_data_url',
    newColumn: 'signature_attachment_id',
  },
  {
    table: 'inspection_records',
    legacyColumn: 'customer_signature_data_url',
    newColumn: 'customer_signature_attachment_id',
  },
  {
    table: 'form_response_steps',
    legacyColumn: 'signature_data_url',
    newColumn: 'signature_attachment_id',
  },
  {
    table: 'flow_gates',
    legacyColumn: 'signature_data_url',
    newColumn: 'signature_attachment_id',
  },
  {
    table: 'training_lesson_progress',
    legacyColumn: 'evaluation_signature_data_url',
    newColumn: 'evaluation_signature_attachment_id',
  },
  {
    table: 'job_title_task_acknowledgments',
    legacyColumn: 'signature_data_url',
    newColumn: 'signature_attachment_id',
  },
  {
    table: 'ca_complete_steps',
    legacyColumn: 'signature_data_url',
    newColumn: 'signature_attachment_id',
  },
] as const

type Target = (typeof TARGETS)[number]
type LegacyRow = { id: string; tenant_id: string; value: string }
type SignatureObject = {
  body: Buffer
  contentType: 'image/png' | 'image/jpeg'
  extension: 'png' | 'jpg'
  sha256: string
}

type AuditSummary = {
  rows: number
  dataUrls: number
  httpUrls: number
  decodedBytes: number
  malformed: number
  oversize: number
  mimeCounts: Record<string, number>
  failures: { table: string; id: string; reason: string }[]
}

const { sql } = createClient({ url: DATABASE_URL, max: CONCURRENCY + 2 })
const { sql: lockSql } = createClient({ url: DATABASE_URL, max: 1 })

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(identifier)) throw new Error('Unsafe SQL identifier')
  return `"${identifier}"`
}

function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

function validateSignatureBytes(contentType: string, body: Buffer): SignatureObject {
  const normalized = contentType.split(';', 1)[0]!.trim().toLowerCase()
  if (normalized !== 'image/png' && normalized !== 'image/jpeg') {
    throw new Error(`unsupported content type ${normalized || '(empty)'}`)
  }
  if (body.length === 0) throw new Error('empty signature')
  if (body.length > MAX_SIGNATURE_BYTES) throw new Error('signature exceeds 10 MiB')

  const isPng =
    body.length >= 8 &&
    body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const isJpeg = body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff
  if ((normalized === 'image/png' && !isPng) || (normalized === 'image/jpeg' && !isJpeg)) {
    throw new Error('declared image type does not match file signature')
  }
  return {
    body,
    contentType: normalized,
    extension: normalized === 'image/png' ? 'png' : 'jpg',
    sha256: createHash('sha256').update(body).digest('hex'),
  }
}

function decodeDataUrl(value: string): SignatureObject {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]*={0,2})$/s.exec(value.trim())
  if (!match || !match[2] || match[2].length % 4 !== 0) {
    throw new Error('malformed base64 PNG/JPEG data URL')
  }
  const body = Buffer.from(match[2], 'base64')
  if (body.toString('base64').replace(/=+$/, '') !== match[2].replace(/=+$/, '')) {
    throw new Error('non-canonical or malformed base64')
  }
  return validateSignatureBytes(match[1]!, body)
}

function tenantKeyFromLegacyUrl(value: string, tenantId: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('invalid legacy HTTP URL')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('legacy URL must use HTTP(S)')
  }
  const parts = parsed.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part))
  const tenantMarker = parts.findIndex(
    (part, index) =>
      part === 't' && parts[index + 1] === tenantId && parts[index + 2] === 'signature',
  )
  if (tenantMarker < 0) throw new Error('legacy URL key is not tenant/signature scoped')
  const key = parts.slice(tenantMarker).join('/')
  if (!key.startsWith(`t/${tenantId}/signature/`) || key.includes('..')) {
    throw new Error('legacy URL key failed tenant validation')
  }
  return key
}

async function readLegacyObject(
  value: string,
  tenantId: string,
): Promise<{
  key: string
  signature: SignatureObject
}> {
  const key = tenantKeyFromLegacyUrl(value, tenantId)
  const [metadata, body] = await Promise.all([headObject({ key }), getObject({ key })])
  if (!metadata) throw new Error('legacy URL object does not exist')
  const signature = validateSignatureBytes(metadata.contentType ?? '', body)
  if (metadata.contentLength !== body.length) throw new Error('legacy object size mismatch')
  return { key, signature }
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = cursor++
        const item = items[index]
        if (item === undefined) return
        await fn(item)
      }
    }),
  )
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const [row] = await sql<{ exists: boolean }[]>`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = ${table} and column_name = ${column}
    ) as exists
  `
  return row?.exists ?? false
}

async function rowsForTarget(
  target: Target,
  afterId: string | null,
  hasNewColumn: boolean,
): Promise<LegacyRow[]> {
  const table = quoteIdentifier(target.table)
  const legacy = quoteIdentifier(target.legacyColumn)
  const newColumnFilter = hasNewColumn ? `and ${quoteIdentifier(target.newColumn)} is null` : ''
  const afterFilter = afterId ? 'and id > $1::uuid' : ''
  const parameters = afterId ? [afterId, BATCH_SIZE] : [BATCH_SIZE]
  const limitParameter = afterId ? '$2' : '$1'
  return sql.unsafe(
    `select id::text, tenant_id::text, ${legacy} as value
       from ${table}
      where ${legacy} is not null ${newColumnFilter} ${afterFilter}
      order by id
      limit ${limitParameter}`,
    parameters,
  ) as Promise<LegacyRow[]>
}

async function audit(): Promise<AuditSummary> {
  const summary: AuditSummary = {
    rows: 0,
    dataUrls: 0,
    httpUrls: 0,
    decodedBytes: 0,
    malformed: 0,
    oversize: 0,
    mimeCounts: {},
    failures: [],
  }

  for (const target of TARGETS) {
    const hasNewColumn = await columnExists(target.table, target.newColumn)
    let afterId: string | null = null
    let targetRows = 0
    for (;;) {
      const rows = await rowsForTarget(target, afterId, hasNewColumn)
      if (rows.length === 0) break
      for (const row of rows) {
        summary.rows++
        targetRows++
        try {
          let signature: SignatureObject
          if (/^https?:\/\//i.test(row.value)) {
            summary.httpUrls++
            ;({ signature } = await readLegacyObject(row.value, row.tenant_id))
          } else {
            summary.dataUrls++
            signature = decodeDataUrl(row.value)
          }
          summary.decodedBytes += signature.body.length
          summary.mimeCounts[signature.contentType] =
            (summary.mimeCounts[signature.contentType] ?? 0) + 1
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'unknown parse failure'
          if (reason.includes('exceeds 10 MiB')) summary.oversize++
          else summary.malformed++
          if (summary.failures.length < 25) {
            summary.failures.push({ table: target.table, id: row.id, reason })
          }
        }
      }
      afterId = rows.at(-1)!.id
      if (targetRows % 10_000 === 0)
        console.log(`[signature-cutover] audited ${targetRows} ${target.table} rows`)
    }
    console.log(`[signature-cutover] ${target.table}: ${targetRows} legacy values audited`)
  }
  return summary
}

function deterministicMigrationKey(
  target: Target,
  row: LegacyRow,
  signature: SignatureObject,
): string {
  const table = target.table.replace(/_/g, '-')
  return `t/${row.tenant_id}/signature/migration/${table}/${row.id}-${signature.sha256.slice(0, 24)}.${signature.extension}`
}

async function verifyObject(key: string, expected: SignatureObject): Promise<boolean> {
  const metadata = await headObject({ key })
  if (!metadata) return false
  const body = await getObject({ key })
  const hash = createHash('sha256').update(body).digest('hex')
  if (
    metadata.contentLength !== expected.body.length ||
    metadata.contentType?.split(';', 1)[0]?.toLowerCase() !== expected.contentType ||
    !hashesEqual(hash, expected.sha256)
  ) {
    throw new Error(`existing object failed integrity verification: ${key}`)
  }
  return true
}

async function migrateRow(target: Target, row: LegacyRow): Promise<'migrated' | 'already'> {
  const fromUrl = /^https?:\/\//i.test(row.value)
  const source = fromUrl ? await readLegacyObject(row.value, row.tenant_id) : null
  const signature = source?.signature ?? decodeDataUrl(row.value)
  const key = source?.key ?? deterministicMigrationKey(target, row, signature)
  if (!key.startsWith(`t/${row.tenant_id}/signature/`))
    throw new Error('generated key escaped tenant')

  let createdObject = false
  if (!(await verifyObject(key, signature))) {
    if (source) throw new Error('legacy URL object disappeared during migration')
    await putObject({
      key,
      body: signature.body,
      contentType: signature.contentType,
      contentDisposition: 'inline',
    })
    createdObject = true
    if (!(await verifyObject(key, signature)))
      throw new Error('uploaded object could not be verified')
  }

  try {
    return await sql.begin(async (tx) => {
      const table = quoteIdentifier(target.table)
      const legacy = quoteIdentifier(target.legacyColumn)
      const newColumn = quoteIdentifier(target.newColumn)
      const [current] = (await tx.unsafe(
        `select tenant_id::text, ${legacy} as legacy_value, ${newColumn}::text as attachment_id
           from ${table} where id = $1::uuid for update`,
        [row.id],
      )) as { tenant_id: string; legacy_value: string | null; attachment_id: string | null }[]
      if (!current || current.tenant_id !== row.tenant_id)
        throw new Error('source row changed tenant')
      if (current.attachment_id) return 'already' as const
      if (current.legacy_value !== row.value)
        throw new Error('legacy value changed during migration')

      const [existingAttachment] = await tx<
        { id: string; tenant_id: string; content_type: string; size_bytes: string }[]
      >`select id::text, tenant_id::text, content_type, size_bytes::text
          from attachments where r2_key = ${key} limit 1`
      let attachmentId: string
      if (existingAttachment) {
        if (
          existingAttachment.tenant_id !== row.tenant_id ||
          existingAttachment.content_type !== signature.contentType ||
          Number(existingAttachment.size_bytes) !== signature.body.length
        ) {
          throw new Error('existing attachment metadata does not match migrated object')
        }
        attachmentId = existingAttachment.id
      } else {
        const [created] = await tx<{ id: string }[]>`
          insert into attachments
            (tenant_id, kind, r2_key, content_type, size_bytes, filename, created_at, updated_at)
          values
            (${row.tenant_id}::uuid, 'signature', ${key}, ${signature.contentType},
             ${signature.body.length}, ${`signature.${signature.extension}`}, now(), now())
          returning id::text
        `
        if (!created) throw new Error('attachment insert returned no row')
        attachmentId = created.id
      }

      const updated = await tx.unsafe(
        `update ${table}
            set ${newColumn} = $1::uuid, ${legacy} = null, updated_at = now()
          where id = $2::uuid and ${newColumn} is null and ${legacy} is not null
          returning id`,
        [attachmentId, row.id],
      )
      if (updated.length !== 1) throw new Error('source row was not linked exactly once')
      return 'migrated' as const
    })
  } catch (error) {
    if (createdObject) {
      try {
        await deleteObject({ key })
      } catch (cleanupError) {
        console.error('[signature-cutover] compensation failed', { key, cleanupError })
      }
    }
    throw error
  }
}

async function assertComplete(): Promise<void> {
  const failures: string[] = []
  for (const target of TARGETS) {
    if (!(await columnExists(target.table, target.newColumn))) {
      failures.push(`${target.table}.${target.newColumn} is missing`)
      continue
    }
    const table = quoteIdentifier(target.table)
    const legacy = quoteIdentifier(target.legacyColumn)
    const newColumn = quoteIdentifier(target.newColumn)
    const [counts] = (await sql.unsafe(
      `select
         count(*) filter (where ${legacy} is not null)::int as legacy_values,
         count(*) filter (where ${newColumn} is not null and a.id is null)::int as broken_links,
         count(*) filter (where a.id is not null and a.tenant_id <> t.tenant_id)::int as cross_tenant_links,
         count(*) filter (where a.id is not null and a.r2_key not like ('t/' || t.tenant_id::text || '/signature/%'))::int as invalid_keys
       from ${table} t
       left join attachments a on a.id = t.${newColumn}`,
    )) as {
      legacy_values: number
      broken_links: number
      cross_tenant_links: number
      invalid_keys: number
    }[]
    if (
      !counts ||
      counts.legacy_values !== 0 ||
      counts.broken_links !== 0 ||
      counts.cross_tenant_links !== 0 ||
      counts.invalid_keys !== 0
    ) {
      failures.push(`${target.table}: ${JSON.stringify(counts ?? {})}`)
    }
  }
  if (failures.length)
    throw new Error(`Signature cutover assertion failed:\n${failures.join('\n')}`)
}

async function applyCutover(): Promise<void> {
  for (const target of TARGETS) {
    if (!(await columnExists(target.table, target.newColumn))) {
      throw new Error(`Additive migration has not created ${target.table}.${target.newColumn}`)
    }
  }

  const [lock] = await lockSql<{ locked: boolean }[]>`
    select pg_try_advisory_lock(hashtextextended(${LOCK_NAME}, 0)) as locked
  `
  if (!lock?.locked) throw new Error('Another signature cutover process holds the advisory lock')

  try {
    let migrated = 0
    let already = 0
    for (const target of TARGETS) {
      let afterId: string | null = null
      for (;;) {
        const rows = await rowsForTarget(target, afterId, true)
        if (rows.length === 0) break
        await mapLimit(rows, CONCURRENCY, async (row) => {
          const status = await migrateRow(target, row)
          if (status === 'migrated') migrated++
          else already++
          if ((migrated + already) % 500 === 0) {
            console.log(`[signature-cutover] migrated=${migrated} already=${already}`)
          }
        })
        afterId = rows.at(-1)!.id
      }
    }
    await assertComplete()
    console.log(`[signature-cutover] complete: migrated=${migrated}, already=${already}`)
  } finally {
    await lockSql`select pg_advisory_unlock(hashtextextended(${LOCK_NAME}, 0))`
  }
}

async function main(): Promise<void> {
  console.log(`[signature-cutover] mode=${APPLY ? 'APPLY' : 'AUDIT-ONLY'} bucket=${BUCKET}`)
  const summary = await audit()
  console.log(
    JSON.stringify(
      {
        ...summary,
        decodedMiB: Number((summary.decodedBytes / 1024 / 1024).toFixed(2)),
      },
      null,
      2,
    ),
  )
  if (summary.malformed > 0 || summary.oversize > 0) {
    throw new Error('Audit found malformed/oversize signatures; no writes were performed')
  }
  if (!APPLY) {
    console.log('[signature-cutover] audit passed; rerun with --apply after the additive migration')
    return
  }
  await applyCutover()
}

main()
  .catch((error: unknown) => {
    console.error('[signature-cutover] FAILED:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await Promise.all([sql.end({ timeout: 5 }), lockSql.end({ timeout: 5 })])
  })
