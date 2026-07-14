/**
 * Audit/migrate legacy attachment objects whose keys predate tenant prefixes.
 *
 * Apply mode is a resumable state machine. Before an object or attachment row
 * is changed, an immutable audit_log manifest records the verified source and
 * the exact destination. A killed process can therefore resume after the copy,
 * database update, or source deletion without guessing what it previously saw.
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
const DATABASE_URL = requireCutoverDatabaseTarget(APPLY)
const STORAGE_TARGET = requireCutoverStorageTarget()
const storage = await import('@beaconhs/storage')
if (storage.BUCKET !== STORAGE_TARGET.bucket) {
  throw new Error('Storage package bucket does not match the audited cutover target')
}

const LOCK_NAME = 'beaconhs:tenant-storage-key-cutover:v1'
const MANIFEST_PREFIX = 'tenant-storage-key-cutover:v1:'
const UPDATE_PREFIX = 'tenant-storage-key-cutover-update:v1:'
const MANIFEST_SCHEMA = 'beaconhs.tenant-storage-key-cutover/v1'
const MANIFEST_SUMMARY = 'Immutable tenant storage key cutover manifest'
const UPDATE_SUMMARY = 'Moved attachment to its tenant-scoped object key'
const DELETE_ATTEMPTS = 4
const HEAD_CONCURRENCY = 32
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const KINDS = new Set(['image', 'document', 'video', 'audio', 'signature', 'other'])

const { sql } = createClient({ url: DATABASE_URL, max: 2 })
const { sql: lockSql } = createClient({ url: DATABASE_URL, max: 1 })

type AttachmentKind = 'image' | 'document' | 'video' | 'audio' | 'signature' | 'other'
type Row = {
  id: string
  tenant_id: string
  kind: AttachmentKind
  r2_key: string
  content_type: string
  size_bytes: string
  filename: string
}
type ObjectMetadata = {
  contentLength: number
  contentType: string | null
  contentDisposition: string | null
  metadataSha256: string
  etag: string | null
}
type DestinationMetadata = {
  contentLength: number
  contentType: string
  contentDisposition: 'inline' | 'attachment'
  metadataSha256: string
  etagRequired: true
}
type Manifest = {
  schema: typeof MANIFEST_SCHEMA
  attachment: {
    id: string
    tenantId: string
    kind: AttachmentKind
    filename: string
    contentType: string
    sizeBytes: number
  }
  source: {
    key: string
    metadata: ObjectMetadata
    sha256: string
  }
  destination: {
    key: string
    metadata: DestinationMetadata
    sha256: string
  }
}
type ManifestAuditRow = {
  tenant_id: string
  actor_user_id: string | null
  actor_ip: string | null
  actor_user_agent: string | null
  entity_type: string
  entity_id: string | null
  action: string
  dedup_key: string | null
  summary: string | null
  before: unknown
  after: unknown
  metadata: unknown
}
type PreparedItem = { row: Row; manifest: Manifest; persisted: boolean }

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'file'
}

function hashesEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  return timingSafeEqual(a, b)
}

function normalizedContentType(value: string): string {
  return value.split(';', 1)[0]!.trim().toLowerCase()
}

function plainMetadata(value: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  )
}

function objectMetadata(value: Awaited<ReturnType<typeof storage.headObject>>): ObjectMetadata {
  if (!value) throw new Error('Cannot snapshot a missing object')
  return {
    contentLength: value.contentLength,
    contentType: value.contentType,
    contentDisposition: value.contentDisposition,
    metadataSha256: createHash('sha256')
      .update(canonicalJson(plainMetadata(value.metadata)))
      .digest('hex'),
    etag: value.etag,
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Manifest contains a non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    )
    return `{${entries
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`
  }
  throw new Error(`Manifest contains unsupported ${typeof value}`)
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return value as Record<string, unknown>
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort()
  const required = [...expected].sort()
  if (!valuesEqual(actual, required)) throw new Error(`${label} has unexpected or missing fields`)
}

function validateManifestShape(value: unknown): asserts value is Manifest {
  const manifest = objectRecord(value, 'Manifest')
  assertExactKeys(manifest, ['schema', 'attachment', 'source', 'destination'], 'Manifest')
  const attachment = objectRecord(manifest.attachment, 'Manifest attachment')
  assertExactKeys(
    attachment,
    ['id', 'tenantId', 'kind', 'filename', 'contentType', 'sizeBytes'],
    'Manifest attachment',
  )
  if (
    typeof attachment.id !== 'string' ||
    typeof attachment.tenantId !== 'string' ||
    typeof attachment.kind !== 'string' ||
    typeof attachment.filename !== 'string' ||
    typeof attachment.contentType !== 'string' ||
    typeof attachment.sizeBytes !== 'number'
  ) {
    throw new Error('Manifest attachment fields have invalid types')
  }

  const source = objectRecord(manifest.source, 'Manifest source')
  const destination = objectRecord(manifest.destination, 'Manifest destination')
  assertExactKeys(source, ['key', 'metadata', 'sha256'], 'Manifest source')
  assertExactKeys(destination, ['key', 'metadata', 'sha256'], 'Manifest destination')
  if (
    typeof source.key !== 'string' ||
    typeof source.sha256 !== 'string' ||
    typeof destination.key !== 'string' ||
    typeof destination.sha256 !== 'string'
  ) {
    throw new Error('Manifest object fields have invalid types')
  }

  const sourceMetadata = objectRecord(source.metadata, 'Manifest source metadata')
  assertExactKeys(
    sourceMetadata,
    ['contentLength', 'contentType', 'contentDisposition', 'metadataSha256', 'etag'],
    'Manifest source metadata',
  )
  if (
    typeof sourceMetadata.contentLength !== 'number' ||
    (sourceMetadata.contentType !== null && typeof sourceMetadata.contentType !== 'string') ||
    (sourceMetadata.contentDisposition !== null &&
      typeof sourceMetadata.contentDisposition !== 'string') ||
    typeof sourceMetadata.metadataSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(sourceMetadata.metadataSha256) ||
    (sourceMetadata.etag !== null && typeof sourceMetadata.etag !== 'string')
  ) {
    throw new Error('Manifest source metadata fields have invalid types')
  }

  const destinationMetadata = objectRecord(destination.metadata, 'Manifest destination metadata')
  assertExactKeys(
    destinationMetadata,
    ['contentLength', 'contentType', 'contentDisposition', 'metadataSha256', 'etagRequired'],
    'Manifest destination metadata',
  )
  if (
    typeof destinationMetadata.contentLength !== 'number' ||
    typeof destinationMetadata.contentType !== 'string' ||
    (destinationMetadata.contentDisposition !== 'inline' &&
      destinationMetadata.contentDisposition !== 'attachment') ||
    typeof destinationMetadata.metadataSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(destinationMetadata.metadataSha256) ||
    destinationMetadata.etagRequired !== true
  ) {
    throw new Error('Manifest destination metadata fields have invalid types')
  }
}

function sizeBytes(row: Row): number {
  const value = Number(row.size_bytes)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Attachment ${row.id} has invalid size_bytes`)
  }
  return value
}

function validateRow(row: Row): void {
  if (!UUID_RE.test(row.id)) throw new Error(`Attachment has invalid id: ${row.id}`)
  if (!UUID_RE.test(row.tenant_id)) throw new Error(`Attachment ${row.id} has invalid tenant`)
  if (!KINDS.has(row.kind)) throw new Error(`Attachment ${row.id} has invalid kind`)
  if (!row.r2_key || row.r2_key.startsWith('/') || row.r2_key.split('/').includes('..')) {
    throw new Error(`Attachment ${row.id} has an unsafe object key`)
  }
  if (!normalizedContentType(row.content_type)) {
    throw new Error(`Attachment ${row.id} has an empty content type`)
  }
  sizeBytes(row)
}

function destinationDisposition(row: Row): 'inline' | 'attachment' {
  return row.kind === 'image' ||
    row.kind === 'video' ||
    row.kind === 'audio' ||
    normalizedContentType(row.content_type) === 'application/pdf'
    ? 'inline'
    : 'attachment'
}

function expectedDestinationMetadata(row: Row): DestinationMetadata {
  return {
    contentLength: sizeBytes(row),
    contentType: row.content_type,
    contentDisposition: destinationDisposition(row),
    metadataSha256: createHash('sha256').update(canonicalJson({})).digest('hex'),
    etagRequired: true,
  }
}

function assertExactTenantKey(row: Row, key: string): void {
  const parts = key.split('/')
  if (
    parts.length < 4 ||
    parts[0] !== 't' ||
    parts[1] !== row.tenant_id ||
    parts[2] !== row.kind ||
    parts.slice(3).some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Attachment ${row.id} key is not exactly tenant/kind scoped`)
  }
}

async function attachmentRows(ids?: readonly string[]): Promise<Row[]> {
  if (ids && ids.length === 0) return []
  if (ids) {
    return sql<Row[]>`
      select id::text, tenant_id::text, kind, r2_key, content_type, size_bytes::text, filename
      from attachments where id = any(${sql.array([...ids])}::uuid[]) order by id
    `
  }
  return sql<Row[]>`
    select id::text, tenant_id::text, kind, r2_key, content_type, size_bytes::text, filename
    from attachments where r2_key not like 't/%' order by id
  `
}

async function manifestAuditRows(): Promise<ManifestAuditRow[]> {
  return sql<ManifestAuditRow[]>`
    select tenant_id::text, actor_user_id, actor_ip, actor_user_agent,
           entity_type, entity_id::text, action, dedup_key, summary, before, after, metadata
    from audit_log
    where dedup_key like ${`${MANIFEST_PREFIX}%`}
    order by tenant_id, dedup_key
  `
}

function manifestFromAudit(row: ManifestAuditRow): Manifest {
  const id = row.dedup_key?.slice(MANIFEST_PREFIX.length) ?? ''
  if (!UUID_RE.test(id)) throw new Error('Tenant storage cutover manifest has invalid dedup key')
  validateManifestShape(row.metadata)
  const manifest = row.metadata
  if (
    row.actor_user_id !== null ||
    row.actor_ip !== null ||
    row.actor_user_agent !== null ||
    row.entity_type !== 'tenant_storage_key_cutover_manifest' ||
    row.entity_id !== id ||
    row.action !== 'create' ||
    row.dedup_key !== `${MANIFEST_PREFIX}${id}` ||
    row.summary !== MANIFEST_SUMMARY ||
    row.before !== null ||
    row.after !== null ||
    manifest.schema !== MANIFEST_SCHEMA ||
    manifest.attachment.id !== id ||
    manifest.attachment.tenantId !== row.tenant_id
  ) {
    throw new Error(`Tenant storage cutover manifest conflicts for attachment ${id}`)
  }
  validateManifest(manifest)
  return manifest
}

function validateManifest(manifest: Manifest): void {
  validateManifestShape(manifest)
  const syntheticRow: Row = {
    id: manifest.attachment.id,
    tenant_id: manifest.attachment.tenantId,
    kind: manifest.attachment.kind,
    r2_key: manifest.source.key,
    content_type: manifest.attachment.contentType,
    size_bytes: String(manifest.attachment.sizeBytes),
    filename: manifest.attachment.filename,
  }
  validateRow(syntheticRow)
  if (manifest.source.key.startsWith('t/')) {
    throw new Error(`Manifest ${manifest.attachment.id} source is not a legacy key`)
  }
  assertExactTenantKey(syntheticRow, manifest.destination.key)
  if (
    !/^[0-9a-f]{64}$/i.test(manifest.source.sha256) ||
    !hashesEqual(manifest.source.sha256, manifest.destination.sha256) ||
    manifest.source.metadata.contentLength !== manifest.attachment.sizeBytes ||
    normalizedContentType(manifest.source.metadata.contentType ?? '') !==
      normalizedContentType(manifest.attachment.contentType) ||
    !valuesEqual(manifest.destination.metadata, expectedDestinationMetadata(syntheticRow))
  ) {
    throw new Error(
      `Tenant storage cutover manifest metadata conflicts for attachment ${manifest.attachment.id}`,
    )
  }
  const expectedKey = destinationKey(syntheticRow, manifest.source.sha256)
  if (manifest.destination.key !== expectedKey) {
    throw new Error(
      `Tenant storage cutover manifest key conflicts for attachment ${manifest.attachment.id}`,
    )
  }
}

function destinationKey(row: Row, sha256: string): string {
  return `t/${row.tenant_id}/${row.kind}/migration/${row.id}-${sha256.slice(0, 24)}-${safeFilename(row.filename)}`
}

function assertRowMatchesManifest(row: Row, manifest: Manifest): void {
  validateRow(row)
  const expected = manifest.attachment
  if (
    row.id !== expected.id ||
    row.tenant_id !== expected.tenantId ||
    row.kind !== expected.kind ||
    row.filename !== expected.filename ||
    row.content_type !== expected.contentType ||
    sizeBytes(row) !== expected.sizeBytes ||
    (row.r2_key !== manifest.source.key && row.r2_key !== manifest.destination.key)
  ) {
    throw new Error(`Attachment ${row.id} conflicts with its immutable cutover manifest`)
  }
}

async function assertAllAttachmentObjects(): Promise<void> {
  const rows = await sql<Row[]>`
    select id::text, tenant_id::text, kind, r2_key, content_type, size_bytes::text, filename
    from attachments order by id
  `
  let cursor = 0
  const failures: string[] = []
  await Promise.all(
    Array.from({ length: Math.min(HEAD_CONCURRENCY, rows.length) }, async () => {
      for (;;) {
        const row = rows[cursor++]
        if (!row) return
        validateRow(row)
        try {
          const metadata = await storage.headObject({ key: row.r2_key })
          if (
            !metadata ||
            metadata.contentLength !== sizeBytes(row) ||
            normalizedContentType(metadata.contentType ?? '') !==
              normalizedContentType(row.content_type)
          ) {
            if (failures.length < 25) failures.push(row.id)
          }
        } catch {
          if (failures.length < 25) failures.push(row.id)
        }
      }
    }),
  )
  if (failures.length) {
    throw new Error(`Attachment objects are missing or inconsistent: ${failures.join(', ')}`)
  }
  console.log(`[tenant-key-cutover] verified attachment objects=${rows.length}`)
}

async function stableObjectSnapshot(
  key: string,
): Promise<{ metadata: ObjectMetadata; sha256: string }> {
  const before = objectMetadata(await storage.headObject({ key }))
  const bytes = await storage.getObject({ key })
  const after = objectMetadata(await storage.headObject({ key }))
  if (!valuesEqual(before, after) || bytes.length !== before.contentLength) {
    throw new Error(`Object changed while it was being verified: ${key}`)
  }
  return { metadata: before, sha256: createHash('sha256').update(bytes).digest('hex') }
}

async function existingObjectSnapshot(
  key: string,
): Promise<{ metadata: ObjectMetadata; sha256: string } | null> {
  if (!(await storage.headObject({ key }))) return null
  return stableObjectSnapshot(key)
}

function assertSourceSnapshot(
  manifest: Manifest,
  actual: { metadata: ObjectMetadata; sha256: string },
) {
  if (
    !valuesEqual(actual.metadata, manifest.source.metadata) ||
    !hashesEqual(actual.sha256, manifest.source.sha256)
  ) {
    throw new Error(`Attachment ${manifest.attachment.id} source object conflicts with manifest`)
  }
}

function assertDestinationSnapshot(
  manifest: Manifest,
  actual: { metadata: ObjectMetadata; sha256: string },
) {
  const expected = manifest.destination.metadata
  const actualComparable = {
    contentLength: actual.metadata.contentLength,
    contentType: actual.metadata.contentType,
    contentDisposition: actual.metadata.contentDisposition,
    metadataSha256: actual.metadata.metadataSha256,
    etagRequired: actual.metadata.etag !== null && actual.metadata.etag.length > 0,
  }
  if (
    !valuesEqual(actualComparable, expected) ||
    !hashesEqual(actual.sha256, manifest.destination.sha256)
  ) {
    throw new Error(
      `Attachment ${manifest.attachment.id} destination object conflicts with manifest`,
    )
  }
}

async function createManifest(row: Row): Promise<Manifest> {
  const source = await stableObjectSnapshot(row.r2_key)
  if (
    source.metadata.contentLength !== sizeBytes(row) ||
    normalizedContentType(source.metadata.contentType ?? '') !==
      normalizedContentType(row.content_type)
  ) {
    throw new Error(`Attachment ${row.id} source object metadata does not match the database`)
  }
  const key = destinationKey(row, source.sha256)
  const manifest: Manifest = {
    schema: MANIFEST_SCHEMA,
    attachment: {
      id: row.id,
      tenantId: row.tenant_id,
      kind: row.kind,
      filename: row.filename,
      contentType: row.content_type,
      sizeBytes: sizeBytes(row),
    },
    source: { key: row.r2_key, metadata: source.metadata, sha256: source.sha256 },
    destination: {
      key,
      metadata: expectedDestinationMetadata(row),
      sha256: source.sha256,
    },
  }
  validateManifest(manifest)
  return manifest
}

async function persistManifest(manifest: Manifest): Promise<void> {
  const dedupKey = `${MANIFEST_PREFIX}${manifest.attachment.id}`
  await sql`
    insert into audit_log
      (tenant_id, entity_type, entity_id, action, dedup_key, summary, metadata)
    values
      (${manifest.attachment.tenantId}::uuid, 'tenant_storage_key_cutover_manifest',
       ${manifest.attachment.id}::uuid, 'create', ${dedupKey}, ${MANIFEST_SUMMARY},
       ${JSON.stringify(manifest)}::jsonb)
    on conflict (tenant_id, dedup_key) do nothing
  `
  const [stored] = await sql<ManifestAuditRow[]>`
    select tenant_id::text, actor_user_id, actor_ip, actor_user_agent,
           entity_type, entity_id::text, action, dedup_key, summary, before, after, metadata
    from audit_log
    where tenant_id = ${manifest.attachment.tenantId}::uuid and dedup_key = ${dedupKey}
  `
  if (!stored || !valuesEqual(manifestFromAudit(stored), manifest)) {
    throw new Error(`Immutable manifest conflict for attachment ${manifest.attachment.id}`)
  }
}

async function assertUpdateAudit(manifest: Manifest): Promise<void> {
  const dedupKey = `${UPDATE_PREFIX}${manifest.attachment.id}`
  const [row] = await sql<ManifestAuditRow[]>`
    select tenant_id::text, actor_user_id, actor_ip, actor_user_agent,
           entity_type, entity_id::text, action, dedup_key, summary, before, after, metadata
    from audit_log
    where tenant_id = ${manifest.attachment.tenantId}::uuid and dedup_key = ${dedupKey}
  `
  if (
    !row ||
    row.actor_user_id !== null ||
    row.actor_ip !== null ||
    row.actor_user_agent !== null ||
    row.entity_type !== 'attachment' ||
    row.entity_id !== manifest.attachment.id ||
    row.action !== 'update' ||
    row.dedup_key !== dedupKey ||
    row.summary !== UPDATE_SUMMARY ||
    !valuesEqual(row.before, { r2Key: manifest.source.key }) ||
    !valuesEqual(row.after, { r2Key: manifest.destination.key }) ||
    !valuesEqual(row.metadata, {
      manifestDedupKey: `${MANIFEST_PREFIX}${manifest.attachment.id}`,
    })
  ) {
    throw new Error(`Attachment ${manifest.attachment.id} has no truthful cutover update audit`)
  }
}

async function prepare(): Promise<PreparedItem[]> {
  const auditRows = await manifestAuditRows()
  const manifests = new Map<string, Manifest>()
  for (const auditRow of auditRows) {
    const manifest = manifestFromAudit(auditRow)
    if (manifests.has(manifest.attachment.id)) {
      throw new Error(`Duplicate manifests exist for attachment ${manifest.attachment.id}`)
    }
    manifests.set(manifest.attachment.id, manifest)
  }

  const manifestAttachments = await attachmentRows([...manifests.keys()])
  if (manifestAttachments.length !== manifests.size) {
    throw new Error('A tenant storage cutover manifest references a missing attachment')
  }
  const rowsById = new Map(manifestAttachments.map((row) => [row.id, row]))
  const legacyRows = await attachmentRows()
  for (const row of legacyRows) rowsById.set(row.id, row)

  const prepared: PreparedItem[] = []
  for (const row of [...rowsById.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    validateRow(row)
    const persisted = manifests.get(row.id)
    const manifest = persisted ?? (await createManifest(row))
    assertRowMatchesManifest(row, manifest)

    const [source, destination] = await Promise.all([
      existingObjectSnapshot(manifest.source.key),
      existingObjectSnapshot(manifest.destination.key),
    ])
    if (source) assertSourceSnapshot(manifest, source)
    if (destination) assertDestinationSnapshot(manifest, destination)
    if (!source && !destination) {
      throw new Error(`Attachment ${row.id} has neither its source nor destination object`)
    }
    if (row.r2_key === manifest.destination.key && !destination) {
      throw new Error(`Attachment ${row.id} database key points at a missing destination`)
    }
    prepared.push({ row, manifest, persisted: Boolean(persisted) })
  }
  return prepared
}

async function deleteAndAssertAbsent(key: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= DELETE_ATTEMPTS; attempt++) {
    try {
      await storage.deleteObject({ key })
      lastError = undefined
    } catch (error) {
      lastError = error
    }
    if (!(await storage.headObject({ key }))) return
    if (attempt < DELETE_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 250))
    }
  }
  throw new Error(
    `Object remained after ${DELETE_ATTEMPTS} delete attempts: ${key}`,
    lastError === undefined ? undefined : { cause: lastError },
  )
}

async function migrate(item: PreparedItem): Promise<'migrated' | 'already'> {
  const { row, manifest } = item
  if (!item.persisted) await persistManifest(manifest)

  let destination = await existingObjectSnapshot(manifest.destination.key)
  if (!destination) {
    const source = await existingObjectSnapshot(manifest.source.key)
    if (!source) throw new Error(`Attachment ${row.id} source disappeared before copy`)
    assertSourceSnapshot(manifest, source)
    if (!source.metadata.etag) {
      throw new Error(`Attachment ${row.id} source has no ETag for a conditional copy`)
    }
    await storage.promoteObject({
      sourceKey: manifest.source.key,
      sourceEtag: source.metadata.etag,
      destinationKey: manifest.destination.key,
      contentType: manifest.destination.metadata.contentType,
      contentDisposition: manifest.destination.metadata.contentDisposition,
    })
    destination = await existingObjectSnapshot(manifest.destination.key)
    if (!destination) throw new Error(`Attachment ${row.id} destination disappeared after copy`)
    try {
      assertDestinationSnapshot(manifest, destination)
    } catch (error) {
      await deleteAndAssertAbsent(manifest.destination.key)
      throw error
    }
  } else {
    assertDestinationSnapshot(manifest, destination)
  }

  const status = await sql.begin(async (tx) => {
    const [current] = await tx<Row[]>`
      select id::text, tenant_id::text, kind, r2_key, content_type, size_bytes::text, filename
      from attachments where id = ${row.id}::uuid for update
    `
    if (!current) throw new Error(`Attachment ${row.id} disappeared during cutover`)
    assertRowMatchesManifest(current, manifest)
    if (current.r2_key === manifest.destination.key) return 'already' as const
    const updated = await tx<{ id: string }[]>`
      update attachments set r2_key = ${manifest.destination.key}, updated_at = now()
      where id = ${row.id}::uuid and r2_key = ${manifest.source.key}
      returning id::text
    `
    if (updated.length !== 1) throw new Error(`Attachment ${row.id} was not updated exactly once`)
    await tx`
      insert into audit_log
        (tenant_id, entity_type, entity_id, action, dedup_key, summary, before, after, metadata)
      values
        (${manifest.attachment.tenantId}::uuid, 'attachment', ${manifest.attachment.id}::uuid,
         'update', ${`${UPDATE_PREFIX}${manifest.attachment.id}`}, ${UPDATE_SUMMARY},
         ${JSON.stringify({ r2Key: manifest.source.key })}::jsonb,
         ${JSON.stringify({ r2Key: manifest.destination.key })}::jsonb,
         ${JSON.stringify({ manifestDedupKey: `${MANIFEST_PREFIX}${manifest.attachment.id}` })}::jsonb)
    `
    return 'migrated' as const
  })

  const destinationBeforeDelete = await existingObjectSnapshot(manifest.destination.key)
  if (!destinationBeforeDelete) {
    throw new Error(`Attachment ${row.id} destination disappeared before source deletion`)
  }
  assertDestinationSnapshot(manifest, destinationBeforeDelete)
  const source = await existingObjectSnapshot(manifest.source.key)
  if (source) {
    assertSourceSnapshot(manifest, source)
    await deleteAndAssertAbsent(manifest.source.key)
  }
  if (await storage.headObject({ key: manifest.source.key })) {
    throw new Error(`Attachment ${row.id} source object still exists after deletion`)
  }
  const finalDestination = await existingObjectSnapshot(manifest.destination.key)
  if (!finalDestination)
    throw new Error(`Attachment ${row.id} destination is missing after cutover`)
  assertDestinationSnapshot(manifest, finalDestination)
  return status
}

async function invalidAttachmentKeys(canonicalOnly: boolean): Promise<Row[]> {
  return sql<Row[]>`
    select id::text, tenant_id::text, kind, r2_key, content_type, size_bytes::text, filename
    from attachments
    where (not ${canonicalOnly} or r2_key like 't/%')
      and (r2_key not like ('t/' || tenant_id::text || '/' || kind::text || '/%')
       or r2_key like '%//%'
       or r2_key ~ '(^|/)\\.\\.?(/|$)'
       or right(r2_key, 1) = '/')
    order by id
    limit 25
  `
}

async function assertCanonicalAttachmentKeyScope(): Promise<void> {
  const invalidKeys = await invalidAttachmentKeys(true)
  if (invalidKeys.length) {
    throw new Error(
      `Canonical attachments have malformed tenant/kind keys: ${invalidKeys.map((row) => row.id).join(', ')}`,
    )
  }
}

async function assertExactAttachmentKeyScope(): Promise<void> {
  const invalidKeys = await invalidAttachmentKeys(false)
  if (invalidKeys.length) {
    throw new Error(
      `Attachments remain outside their exact tenant/kind key scope: ${invalidKeys.map((row) => row.id).join(', ')}`,
    )
  }
}

async function assertComplete(): Promise<void> {
  await assertExactAttachmentKeyScope()
  await assertAllAttachmentObjects()
  const auditRows = await manifestAuditRows()
  for (const auditRow of auditRows) {
    const manifest = manifestFromAudit(auditRow)
    const [row] = await attachmentRows([manifest.attachment.id])
    if (!row) throw new Error(`Manifest attachment ${manifest.attachment.id} is missing`)
    assertRowMatchesManifest(row, manifest)
    if (row.r2_key !== manifest.destination.key) {
      throw new Error(`Manifest attachment ${row.id} was not reconciled to its destination`)
    }
    await assertUpdateAudit(manifest)
    if (await storage.headObject({ key: manifest.source.key })) {
      throw new Error(`Manifest attachment ${row.id} still has its legacy source object`)
    }
    const destination = await existingObjectSnapshot(manifest.destination.key)
    if (!destination) throw new Error(`Manifest attachment ${row.id} destination is missing`)
    assertDestinationSnapshot(manifest, destination)
  }
}

async function assertStorageTarget(items: PreparedItem[]): Promise<void> {
  const first = items[0]
  if (first) {
    const key =
      (await storage.headObject({ key: first.manifest.destination.key })) !== null
        ? first.manifest.destination.key
        : first.manifest.source.key
    await assertCutoverObjectPrivate(key, STORAGE_TARGET)
    return
  }
  const [attachment] = await sql<{ r2_key: string }[]>`
    select r2_key from attachments order by id limit 1
  `
  if (attachment) {
    const probe = attachment.r2_key
    if (!(await storage.headObject({ key: probe }))) {
      throw new Error('Cannot prove storage target: sampled attachment object is missing')
    }
    await assertCutoverObjectPrivate(attachment.r2_key, STORAGE_TARGET)
  }
}

async function auditOnly(): Promise<void> {
  await assertCanonicalAttachmentKeyScope()
  await assertAllAttachmentObjects()
  const items = await prepare()
  await assertStorageTarget(items)
  const bytes = items.reduce((sum, item) => sum + item.manifest.attachment.sizeBytes, 0)
  console.log('[tenant-key-cutover]', {
    mode: 'AUDIT-ONLY',
    attachments: items.length,
    persistedManifests: items.filter((item) => item.persisted).length,
    bytes,
  })
}

async function applyCutover(): Promise<void> {
  const lockConnection = await lockSql.reserve()
  let lockHeld = false
  try {
    const [lock] = await lockConnection<{ locked: boolean }[]>`
      select pg_try_advisory_lock(hashtextextended(${LOCK_NAME}, 0)) as locked
    `
    if (!lock?.locked) throw new Error('Another tenant-key cutover holds the advisory lock')
    lockHeld = true
    await assertCanonicalAttachmentKeyScope()
    await assertAllAttachmentObjects()
    const items = await prepare()
    await assertStorageTarget(items)
    console.log('[tenant-key-cutover]', {
      mode: 'APPLY',
      attachments: items.length,
      persistedManifests: items.filter((item) => item.persisted).length,
      bytes: items.reduce((sum, item) => sum + item.manifest.attachment.sizeBytes, 0),
    })
    let migrated = 0
    let already = 0
    for (const item of items) {
      const status = await migrate(item)
      if (status === 'migrated') migrated++
      else already++
    }
    await assertComplete()
    console.log(`[tenant-key-cutover] complete: migrated=${migrated}, already=${already}`)
  } finally {
    try {
      if (lockHeld) {
        await lockConnection`select pg_advisory_unlock(hashtextextended(${LOCK_NAME}, 0))`
      }
    } finally {
      lockConnection.release()
    }
  }
}

async function main(): Promise<void> {
  await assertCutoverDatabaseSession(sql)
  if (APPLY) await applyCutover()
  else await auditOnly()
}

main()
  .catch((error: unknown) => {
    console.error('[tenant-key-cutover] FAILED:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await Promise.all([sql.end({ timeout: 5 }), lockSql.end({ timeout: 5 })])
  })
