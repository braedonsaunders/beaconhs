/**
 * One-time clean-cutover migration from legacy signature text columns to
 * attachment foreign keys.
 *
 * Safety defaults:
 *   pnpm --filter @beaconhs/web run cutover:run scripts/backfill-signatures-to-storage.ts
 *     audits/decodes every value and writes nothing.
 *
 * Apply only after the additive migration has created every `newColumn`:
 *   ... backfill-signatures-to-storage.ts --apply
 *
 * The apply pass holds a cluster advisory lock, uses deterministic keys so a
 * killed process resumes without duplicating objects, verifies stored bytes by
 * size/type/SHA-256, atomically inserts+links each attachment, nulls the legacy
 * value, compensates failed DB writes, then asserts zero legacy values remain.
 * Once the final migration retires all legacy columns, replay is a no-op only
 * if every canonical attachment column still exists; partial retirement fails.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { createClient } from '@beaconhs/db'
import {
  assertCutoverDatabaseSession,
  assertCutoverObjectPrivate,
  requireCutoverDatabaseTarget,
  requireCutoverStorageTarget,
} from './cutover-target'

const APPLY = process.argv.includes('--apply')
const VERIFY_COMPLETE = process.argv.includes('--verify-complete')
if (APPLY && VERIFY_COMPLETE) {
  throw new Error('--apply and --verify-complete cannot be combined')
}
const DATABASE_URL = requireCutoverDatabaseTarget(APPLY)
const STORAGE_TARGET = requireCutoverStorageTarget()
const BATCH_SIZE = 250
const CONCURRENCY = 8
const MAX_SIGNATURE_BYTES = 10 * 1024 * 1024
const MAX_SIGNATURE_BASE64_CHARS = 4 * Math.ceil(MAX_SIGNATURE_BYTES / 3)
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
type LegacyRow = { id: string; tenant_id: string; value: string; attachment_id: string | null }
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
  dualPopulated: number
  mimeCounts: Record<string, number>
  failures: { table: string; id: string; reason: string }[]
}

const { sql } = createClient({ url: DATABASE_URL, max: CONCURRENCY + 2 })
const { sql: lockSql } = createClient({ url: DATABASE_URL, max: 1 })
let storage: typeof import('@beaconhs/storage')

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(identifier)) throw new Error('Unsafe SQL identifier')
  return `"${identifier}"`
}

function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

function objectMetadataFingerprint(
  value: NonNullable<Awaited<ReturnType<typeof storage.headObject>>>,
): string {
  return JSON.stringify({
    contentLength: value.contentLength,
    contentType: value.contentType,
    contentDisposition: value.contentDisposition,
    etag: value.etag,
    metadata: Object.fromEntries(
      Object.entries(value.metadata).sort(([left], [right]) => left.localeCompare(right)),
    ),
  })
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
  const trimmed = value.trim()
  if (trimmed.length > MAX_SIGNATURE_BASE64_CHARS + 32) {
    throw new Error('signature exceeds 10 MiB')
  }
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]*={0,2})$/s.exec(trimmed)
  if (!match || !match[2] || match[2].length % 4 !== 0) {
    throw new Error('malformed base64 PNG/JPEG data URL')
  }
  if (match[2].length > MAX_SIGNATURE_BASE64_CHARS) {
    throw new Error('signature exceeds 10 MiB')
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
  const before = await storage.headObject({ key })
  if (!before) throw new Error('legacy URL object does not exist')
  if (before.contentLength <= 0 || before.contentLength > MAX_SIGNATURE_BYTES) {
    throw new Error('legacy signature object has an invalid size')
  }
  const body = await storage.getObject({ key })
  const after = await storage.headObject({ key })
  if (!after || objectMetadataFingerprint(before) !== objectMetadataFingerprint(after)) {
    throw new Error('legacy signature object changed while it was read')
  }
  const signature = validateSignatureBytes(before.contentType ?? '', body)
  if (before.contentLength !== body.length) throw new Error('legacy object size mismatch')
  return { key, signature }
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let cursor = 0
  let firstError: unknown
  let failed = false
  let aborted = false
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      if (aborted) return
      const index = cursor++
      const item = items[index]
      if (item === undefined) return
      try {
        await fn(item)
      } catch (error) {
        if (!failed) firstError = error
        failed = true
        aborted = true
        return
      }
    }
  })
  await Promise.allSettled(workers)
  if (failed) throw firstError
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

async function legacyColumnState(): Promise<'present' | 'retired'> {
  const states = await Promise.all(
    TARGETS.map(async (target) => ({
      target,
      present: await columnExists(target.table, target.legacyColumn),
    })),
  )
  const present = states.filter((state) => state.present)
  if (present.length === 0) {
    const missingCanonical = (
      await Promise.all(
        TARGETS.map(async (target) => ({
          target,
          present: await columnExists(target.table, target.newColumn),
        })),
      )
    ).filter((state) => !state.present)
    if (missingCanonical.length > 0) {
      throw new Error(
        `Legacy signature columns are retired but canonical columns are missing: ${missingCanonical
          .map((state) => `${state.target.table}.${state.target.newColumn}`)
          .join(', ')}`,
      )
    }
    return 'retired'
  }
  if (present.length !== TARGETS.length) {
    const missing = states
      .filter((state) => !state.present)
      .map((state) => `${state.target.table}.${state.target.legacyColumn}`)
    throw new Error(`Legacy signature column retirement is partial: ${missing.join(', ')}`)
  }
  return 'present'
}

async function rowsForTarget(
  target: Target,
  afterId: string | null,
  hasNewColumn: boolean,
): Promise<LegacyRow[]> {
  const table = quoteIdentifier(target.table)
  const legacy = quoteIdentifier(target.legacyColumn)
  const attachment = hasNewColumn ? `${quoteIdentifier(target.newColumn)}::text` : 'null::text'
  const afterFilter = afterId ? 'and id > $1::uuid' : ''
  const parameters = afterId ? [afterId, BATCH_SIZE] : [BATCH_SIZE]
  const limitParameter = afterId ? '$2' : '$1'
  return sql.unsafe(
    `select id::text, tenant_id::text, ${legacy} as value, ${attachment} as attachment_id
       from ${table}
      where ${legacy} is not null ${afterFilter}
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
    dualPopulated: 0,
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
        if (row.attachment_id) {
          summary.dualPopulated++
          if (summary.failures.length < 25) {
            summary.failures.push({
              table: target.table,
              id: row.id,
              reason: 'legacy signature and canonical attachment are both populated',
            })
          }
          continue
        }
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

function reportAudit(summary: AuditSummary): void {
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
}

function assertAuditPassed(summary: AuditSummary): void {
  if (summary.malformed > 0 || summary.oversize > 0 || summary.dualPopulated > 0) {
    throw new Error('Audit found invalid or dual-populated signatures; no writes were performed')
  }
}

async function assertStoragePrivacy(): Promise<void> {
  const [candidate] = await sql<{ r2_key: string }[]>`
    select r2_key from attachments order by id limit 1
  `
  if (!candidate) throw new Error('Cannot prove object-store privacy without a known attachment')
  if (!(await storage.headObject({ key: candidate.r2_key }))) {
    throw new Error('Object-store privacy candidate is missing')
  }
  await assertCutoverObjectPrivate(candidate.r2_key, STORAGE_TARGET)
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
  const before = await storage.headObject({ key })
  if (!before) return false
  if (
    before.contentLength !== expected.body.length ||
    before.contentLength > MAX_SIGNATURE_BYTES ||
    before.contentType?.split(';', 1)[0]?.toLowerCase() !== expected.contentType
  ) {
    throw new Error(`existing object metadata failed integrity verification: ${key}`)
  }
  const body = await storage.getObject({ key })
  const after = await storage.headObject({ key })
  if (!after || objectMetadataFingerprint(before) !== objectMetadataFingerprint(after)) {
    throw new Error(`existing object changed during integrity verification: ${key}`)
  }
  const hash = createHash('sha256').update(body).digest('hex')
  if (body.length !== expected.body.length || !hashesEqual(hash, expected.sha256)) {
    throw new Error(`existing object failed integrity verification: ${key}`)
  }
  return true
}

async function migrateRow(target: Target, row: LegacyRow): Promise<void> {
  const fromUrl = /^https?:\/\//i.test(row.value)
  const source = fromUrl ? await readLegacyObject(row.value, row.tenant_id) : null
  const signature = source?.signature ?? decodeDataUrl(row.value)
  const key = source?.key ?? deterministicMigrationKey(target, row, signature)
  if (!key.startsWith(`t/${row.tenant_id}/signature/`))
    throw new Error('generated key escaped tenant')

  let createdObject = false
  try {
    if (!(await verifyObject(key, signature))) {
      if (source) throw new Error('legacy URL object disappeared during migration')
      await storage.putObject({
        key,
        body: signature.body,
        contentType: signature.contentType,
        contentDisposition: 'inline',
      })
      createdObject = true
      if (!(await verifyObject(key, signature))) {
        throw new Error('uploaded object could not be verified')
      }
    }

    await sql.begin(async (tx) => {
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
      if (current.attachment_id)
        throw new Error('source row became dual-populated after the locked preflight')
      if (current.legacy_value !== row.value)
        throw new Error('legacy value changed during migration')

      const [existingAttachment] = await tx<
        {
          id: string
          tenant_id: string
          kind: string
          content_type: string
          size_bytes: string
        }[]
      >`select id::text, tenant_id::text, kind, content_type, size_bytes::text
          from attachments where r2_key = ${key} limit 1`
      let attachmentId: string
      if (existingAttachment) {
        if (
          existingAttachment.tenant_id !== row.tenant_id ||
          existingAttachment.kind !== 'signature' ||
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
    })
    if (!(await verifyObject(key, signature))) {
      throw new Error('linked signature object disappeared after commit')
    }
  } catch (error) {
    if (createdObject) {
      try {
        const [persisted] = await sql<{ id: string }[]>`
          select id::text from attachments where r2_key = ${key} limit 1
        `
        if (!persisted) {
          await storage.deleteObject({ key })
          if (await storage.headObject({ key })) {
            throw new Error('compensated signature object still exists')
          }
        }
      } catch {
        // An ambiguous COMMIT must never cause a referenced object to be
        // deleted. The deterministic key is safe for the next run to reuse.
        console.error('[signature-cutover] compensation check failed', {
          table: target.table,
          id: row.id,
        })
      }
    }
    throw error
  }
}

async function assertCanonicalIntegrity(allowLegacy: boolean): Promise<void> {
  const failures: string[] = []
  const verifiedAttachmentIds = new Set<string>()
  let verifiedObjects = 0
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
         count(*) filter (where a.id is not null and a.r2_key not like ('t/' || t.tenant_id::text || '/signature/%'))::int as invalid_keys,
         count(*) filter (where a.id is not null and a.kind <> 'signature')::int as invalid_kinds,
         count(*) filter (where a.id is not null and a.content_type not in ('image/png', 'image/jpeg'))::int as invalid_types,
         count(*) filter (where a.id is not null and (a.size_bytes <= 0 or a.size_bytes > ${MAX_SIGNATURE_BYTES}))::int as invalid_sizes
       from ${table} t
       left join attachments a on a.id = t.${newColumn}`,
    )) as {
      legacy_values: number
      broken_links: number
      cross_tenant_links: number
      invalid_keys: number
      invalid_kinds: number
      invalid_types: number
      invalid_sizes: number
    }[]
    if (
      !counts ||
      (!allowLegacy && counts.legacy_values !== 0) ||
      counts.broken_links !== 0 ||
      counts.cross_tenant_links !== 0 ||
      counts.invalid_keys !== 0 ||
      counts.invalid_kinds !== 0 ||
      counts.invalid_types !== 0 ||
      counts.invalid_sizes !== 0
    ) {
      failures.push(`${target.table}: ${JSON.stringify(counts ?? {})}`)
    }

    let afterId: string | null = null
    for (;;) {
      const afterFilter = afterId ? 'and t.id > $1::uuid' : ''
      const parameters = afterId ? [afterId, BATCH_SIZE] : [BATCH_SIZE]
      const limitParameter = afterId ? '$2' : '$1'
      const rows = (await sql.unsafe(
        `select t.id::text, t.tenant_id::text, a.id::text as attachment_id,
                a.kind, a.r2_key, a.content_type, a.size_bytes::text
           from ${table} t
           join attachments a on a.id = t.${newColumn}
          where t.${newColumn} is not null ${afterFilter}
          order by t.id
          limit ${limitParameter}`,
        parameters,
      )) as {
        id: string
        tenant_id: string
        attachment_id: string
        kind: string
        r2_key: string
        content_type: string
        size_bytes: string
      }[]
      if (rows.length === 0) break
      await mapLimit(rows, CONCURRENCY, async (row) => {
        if (verifiedAttachmentIds.has(row.attachment_id)) return
        if (row.kind !== 'signature' || !row.r2_key.startsWith(`t/${row.tenant_id}/signature/`)) {
          throw new Error(`Canonical signature metadata is invalid for ${row.attachment_id}`)
        }
        const before = await storage.headObject({ key: row.r2_key })
        const expectedBytes = Number(row.size_bytes)
        if (
          !before ||
          !Number.isSafeInteger(expectedBytes) ||
          expectedBytes > MAX_SIGNATURE_BYTES ||
          before.contentLength !== expectedBytes ||
          before.contentType?.split(';', 1)[0]?.toLowerCase() !== row.content_type
        ) {
          throw new Error(`Canonical signature object metadata is invalid for ${row.attachment_id}`)
        }
        const body = await storage.getObject({ key: row.r2_key })
        const after = await storage.headObject({ key: row.r2_key })
        if (!after || objectMetadataFingerprint(before) !== objectMetadataFingerprint(after)) {
          throw new Error(`Canonical signature object changed while reading ${row.attachment_id}`)
        }
        if (body.length !== expectedBytes) {
          throw new Error(`Canonical signature object size is invalid for ${row.attachment_id}`)
        }
        const signature = validateSignatureBytes(row.content_type, body)
        const migrationPrefix = `t/${row.tenant_id}/signature/migration/${target.table.replace(/_/g, '-')}/${row.id}-`
        if (row.r2_key.startsWith(migrationPrefix)) {
          const keyHash = /^([0-9a-f]{24})\.(?:png|jpg)$/i.exec(
            row.r2_key.slice(migrationPrefix.length),
          )?.[1]
          if (!keyHash || !signature.sha256.toLowerCase().startsWith(keyHash.toLowerCase())) {
            throw new Error(`Canonical signature object hash is invalid for ${row.attachment_id}`)
          }
        }
        verifiedAttachmentIds.add(row.attachment_id)
        verifiedObjects++
      })
      afterId = rows.at(-1)!.id
    }
  }
  if (failures.length)
    throw new Error(`Signature cutover assertion failed:\n${failures.join('\n')}`)
  console.log(`[signature-cutover] verified canonical objects=${verifiedObjects}`)
}

async function additiveColumnsReady(): Promise<boolean> {
  const states = await Promise.all(
    TARGETS.map(async (target) => ({
      target,
      present: await columnExists(target.table, target.newColumn),
    })),
  )
  const present = states.filter((state) => state.present)
  const isBaseline = present.length === 1 && present[0]?.target.table === 'form_response_steps'
  if (!isBaseline && present.length !== TARGETS.length) {
    throw new Error(
      `Additive signature migration is partial (${present.length}/${TARGETS.length} columns)`,
    )
  }
  return present.length === TARGETS.length
}

async function applyCutover(): Promise<void> {
  const lockConnection = await lockSql.reserve()
  let locked = false

  try {
    const [lock] = await lockConnection<{ locked: boolean }[]>`
      select pg_try_advisory_lock(hashtextextended(${LOCK_NAME}, 0)) as locked
    `
    locked = lock?.locked ?? false
    if (!locked) throw new Error('Another signature cutover process holds the advisory lock')

    for (const target of TARGETS) {
      if (!(await columnExists(target.table, target.newColumn))) {
        throw new Error(`Additive migration has not created ${target.table}.${target.newColumn}`)
      }
    }
    const preflight = await audit()
    reportAudit(preflight)
    assertAuditPassed(preflight)
    await assertCanonicalIntegrity(true)

    let migrated = 0
    for (const target of TARGETS) {
      let afterId: string | null = null
      for (;;) {
        const rows = await rowsForTarget(target, afterId, true)
        if (rows.length === 0) break
        await mapLimit(rows, CONCURRENCY, async (row) => {
          await migrateRow(target, row)
          migrated++
          if (migrated % 500 === 0) {
            console.log(`[signature-cutover] migrated=${migrated}`)
          }
        })
        afterId = rows.at(-1)!.id
      }
    }
    await assertCanonicalIntegrity(false)
    const postflight = await audit()
    reportAudit(postflight)
    assertAuditPassed(postflight)
    if (postflight.rows !== 0) throw new Error('Legacy signature values remain after cutover')
    console.log(`[signature-cutover] complete: migrated=${migrated}`)
  } finally {
    try {
      if (locked) {
        await lockConnection`select pg_advisory_unlock(hashtextextended(${LOCK_NAME}, 0))`
      }
    } finally {
      lockConnection.release()
    }
  }
}

async function main(): Promise<void> {
  await assertCutoverDatabaseSession(sql)
  const state = await legacyColumnState()
  if (VERIFY_COMPLETE) {
    if (state !== 'retired') {
      throw new Error(
        'Stored-signature cutover is not complete; run the explicit cutover operation',
      )
    }
    console.log('[signature-cutover] verified complete from database schema; storage audit skipped')
    return
  }
  if (state === 'retired') {
    console.log('[signature-cutover] complete: legacy columns are already retired')
    return
  }

  storage = await import('@beaconhs/storage')
  console.log(`[signature-cutover] mode=${APPLY ? 'APPLY' : 'AUDIT-ONLY'} bucket=${storage.BUCKET}`)
  await assertStoragePrivacy()
  if (APPLY) return applyCutover()

  const summary = await audit()
  reportAudit(summary)
  assertAuditPassed(summary)
  if (await additiveColumnsReady()) {
    await assertCanonicalIntegrity(summary.rows !== 0)
  }
  console.log('[signature-cutover] audit passed; rerun with --apply after the additive migration')
}

main()
  .catch((error: unknown) => {
    console.error('[signature-cutover] FAILED:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await Promise.all([sql.end({ timeout: 5 }), lockSql.end({ timeout: 5 })])
  })
