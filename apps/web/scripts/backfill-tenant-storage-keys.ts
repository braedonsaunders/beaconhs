/** Audit/migrate legacy attachment objects whose keys predate tenant prefixes. */

import { createHash, timingSafeEqual } from 'node:crypto'
import { createClient } from '@beaconhs/db'
import { deleteObject, getObject, headObject, promoteObject } from '@beaconhs/storage'

const DATABASE_URL = process.env.SUPERADMIN_DATABASE_URL
if (!DATABASE_URL) throw new Error('SUPERADMIN_DATABASE_URL is required')
const APPLY = process.argv.includes('--apply')
const LOCK_NAME = 'beaconhs:tenant-storage-key-cutover:v1'
const { sql } = createClient({ url: DATABASE_URL, max: 2 })

type Row = {
  id: string
  tenant_id: string
  kind: 'image' | 'document' | 'video' | 'audio' | 'signature' | 'other'
  r2_key: string
  content_type: string
  size_bytes: string
  filename: string
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'file'
}

function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

async function rows(): Promise<Row[]> {
  return sql<Row[]>`
    select id::text, tenant_id::text, kind, r2_key, content_type, size_bytes::text, filename
    from attachments where r2_key not like 't/%' order by id
  `
}

async function verified(row: Row): Promise<{ bytes: Buffer; sha256: string }> {
  const [metadata, bytes] = await Promise.all([
    headObject({ key: row.r2_key }),
    getObject({ key: row.r2_key }),
  ])
  if (
    !metadata ||
    metadata.contentLength !== Number(row.size_bytes) ||
    bytes.length !== Number(row.size_bytes) ||
    metadata.contentType?.split(';', 1)[0]?.toLowerCase() !==
      row.content_type.split(';', 1)[0]!.toLowerCase()
  ) {
    throw new Error(`Attachment ${row.id} object metadata does not match the database`)
  }
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
}

async function migrate(row: Row): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(row.tenant_id))
    throw new Error(`Attachment ${row.id} has invalid tenant`)
  const source = await verified(row)
  const key = `t/${row.tenant_id}/${row.kind}/migration/${row.id}-${source.sha256.slice(0, 24)}-${safeFilename(row.filename)}`
  if (!key.startsWith(`t/${row.tenant_id}/${row.kind}/`))
    throw new Error('Destination key escaped tenant')

  const existing = await headObject({ key })
  let copied = false
  if (!existing) {
    await promoteObject({
      sourceKey: row.r2_key,
      destinationKey: key,
      contentType: row.content_type,
      contentDisposition:
        row.kind === 'image' ||
        row.kind === 'video' ||
        row.kind === 'audio' ||
        row.content_type === 'application/pdf'
          ? 'inline'
          : 'attachment',
    })
    copied = true
  }
  const destination = await getObject({ key })
  const destinationHash = createHash('sha256').update(destination).digest('hex')
  if (destination.length !== source.bytes.length || !hashesEqual(destinationHash, source.sha256)) {
    if (copied) await deleteObject({ key }).catch(() => {})
    throw new Error(`Attachment ${row.id} destination failed SHA-256 verification`)
  }

  try {
    await sql.begin(async (tx) => {
      const [current] = await tx<{ r2_key: string; tenant_id: string }[]>`
        select r2_key, tenant_id::text from attachments where id = ${row.id}::uuid for update
      `
      if (!current || current.tenant_id !== row.tenant_id)
        throw new Error('Attachment changed tenant')
      if (current.r2_key === key) return
      if (current.r2_key !== row.r2_key) throw new Error('Attachment key changed during migration')
      await tx`update attachments set r2_key = ${key}, updated_at = now() where id = ${row.id}::uuid`
    })
  } catch (error) {
    if (copied) await deleteObject({ key }).catch(() => {})
    throw error
  }
  await deleteObject({ key: row.r2_key })
}

async function main(): Promise<void> {
  const candidates = await rows()
  let bytes = 0
  for (const row of candidates) bytes += (await verified(row)).bytes.length
  console.log('[tenant-key-cutover]', {
    mode: APPLY ? 'APPLY' : 'AUDIT-ONLY',
    attachments: candidates.length,
    bytes,
  })
  if (!APPLY) return

  const [lock] = await sql<{ locked: boolean }[]>`
    select pg_try_advisory_lock(hashtextextended(${LOCK_NAME}, 0)) as locked
  `
  if (!lock?.locked) throw new Error('Another tenant-key cutover holds the advisory lock')
  try {
    for (const row of candidates) await migrate(row)
    const [remaining] = await sql<{ count: number }[]>`
      select count(*)::int as count from attachments where r2_key not like 't/%'
    `
    if ((remaining?.count ?? -1) !== 0) throw new Error('Non-tenant attachment keys remain')
  } finally {
    await sql`select pg_advisory_unlock(hashtextextended(${LOCK_NAME}, 0))`
  }
}

main()
  .catch((error: unknown) => {
    console.error('[tenant-key-cutover] FAILED:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => sql.end({ timeout: 5 }))
