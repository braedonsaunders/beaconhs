/**
 * Clean-cutover migration for persisted rich content that embedded permanent
 * object-store URLs. Default mode audits only; --apply rewrites active training
 * lesson HTML to the stable authenticated attachment route.
 */

import { createClient } from '@beaconhs/db'
import { attachmentUrl } from '../src/lib/attachment-url'

const DATABASE_URL = process.env.SUPERADMIN_DATABASE_URL
if (!DATABASE_URL) throw new Error('SUPERADMIN_DATABASE_URL is required')
const APPLY = process.argv.includes('--apply')
const LOCK_NAME = 'beaconhs:private-attachment-url-cutover:v1'
const STORAGE_URL_RE = /https?:\/\/[^"'\s<>()]+\/t\/[0-9a-f-]{36}\/[^"'\s<>()]+/gi
const ATTACHMENT_ROUTE_RE = /\/api\/attachments\/([0-9a-f-]{36})(?:\?cap=[A-Za-z0-9_-]{43})?/gi

function addCapabilities(value: string): string {
  return value.replace(ATTACHMENT_ROUTE_RE, (_match, id: string) => attachmentUrl(id))
}

function rewriteJson(value: unknown): SqlJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return addCapabilities(value)
  if (Array.isArray(value)) return value.map(rewriteJson)
  if (value && typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new Error('Database JSON contains a non-plain object')
    }
    const out: Record<string, SqlJsonValue> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = rewriteJson(nested)
    }
    return out
  }
  throw new Error(`Database JSON contains unsupported ${typeof value}`)
}

const { sql } = createClient({ url: DATABASE_URL, max: 2 })
type SqlJsonValue = Parameters<typeof sql.json>[0]

function storageKey(value: string, tenantId: string): string {
  const parsed = new URL(value)
  const parts = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const marker = parts.findIndex((part, index) => part === 't' && parts[index + 1] === tenantId)
  if (marker < 0) throw new Error('embedded URL is not scoped to the row tenant')
  const key = parts.slice(marker).join('/')
  if (!key.startsWith(`t/${tenantId}/`) || key.includes('..')) {
    throw new Error('embedded URL key failed tenant validation')
  }
  return key
}

async function audit(): Promise<{ rows: number; urls: number }> {
  const rows = await sql<{ id: string; tenant_id: string; content_html: string }[]>`
    select id::text, tenant_id::text, content_html
    from training_lessons
    where content_html ~ 'https?://[^"[:space:]]+/t/[0-9a-f-]{36}/'
    order by id
  `
  let urls = 0
  for (const row of rows) {
    const matches = row.content_html.match(STORAGE_URL_RE) ?? []
    for (const value of matches) {
      const key = storageKey(value, row.tenant_id)
      const [attachment] = await sql<{ id: string }[]>`
        select id::text from attachments
        where tenant_id = ${row.tenant_id}::uuid and r2_key = ${key}
        limit 1
      `
      if (!attachment) throw new Error(`No tenant attachment matches training_lessons ${row.id}`)
      urls++
    }
  }
  return { rows: rows.length, urls }
}

async function apply(): Promise<void> {
  const [lock] = await sql<{ locked: boolean }[]>`
    select pg_try_advisory_lock(hashtextextended(${LOCK_NAME}, 0)) as locked
  `
  if (!lock?.locked) throw new Error('Another attachment URL cutover holds the advisory lock')
  try {
    const rows = await sql<{ id: string; tenant_id: string; content_html: string }[]>`
      select id::text, tenant_id::text, content_html
      from training_lessons
      where content_html ~ 'https?://[^"[:space:]]+/t/[0-9a-f-]{36}/'
      order by id
    `
    for (const row of rows) {
      let next = addCapabilities(row.content_html)
      for (const value of row.content_html.match(STORAGE_URL_RE) ?? []) {
        const key = storageKey(value, row.tenant_id)
        const [attachment] = await sql<{ id: string }[]>`
          select id::text from attachments
          where tenant_id = ${row.tenant_id}::uuid and r2_key = ${key}
          limit 1
        `
        if (!attachment) throw new Error(`No tenant attachment matches training_lessons ${row.id}`)
        next = next.replaceAll(value, attachmentUrl(attachment.id))
      }
      await sql.begin(async (tx) => {
        const [current] = await tx<{ content_html: string }[]>`
          select content_html from training_lessons where id = ${row.id}::uuid for update
        `
        if (!current) throw new Error(`training_lessons ${row.id} disappeared`)
        if (current.content_html !== row.content_html) {
          throw new Error(`training_lessons ${row.id} changed during cutover`)
        }
        await tx`
          update training_lessons set content_html = ${next}, updated_at = now()
          where id = ${row.id}::uuid
        `
      })
    }
    const responses = await sql<{ id: string; data: unknown }[]>`
      select id::text, data from form_responses
      where data::text like '%/api/attachments/%'
      order by id
    `
    for (const response of responses) {
      const next = rewriteJson(response.data)
      const updated = await sql<{ id: string }[]>`
        update form_responses
        set data = ${JSON.stringify(next)}::jsonb, updated_at = now()
        where id = ${response.id}::uuid
          and data = ${JSON.stringify(response.data)}::jsonb
        returning id::text
      `
      if (updated.length !== 1) {
        throw new Error(`form_responses ${response.id} changed during cutover`)
      }
    }
    const [remaining] = await sql<{ count: number }[]>`
      select count(*)::int as count from training_lessons
      where content_html ~ 'https?://[^"[:space:]]+/t/[0-9a-f-]{36}/'
    `
    if ((remaining?.count ?? -1) !== 0) throw new Error('Embedded public URLs remain')
    console.log(
      `[attachment-url-cutover] rewrote ${rows.length} training lesson rows and ${responses.length} form responses`,
    )
  } finally {
    await sql`select pg_advisory_unlock(hashtextextended(${LOCK_NAME}, 0))`
  }
}

async function main() {
  const summary = await audit()
  console.log(`[attachment-url-cutover] mode=${APPLY ? 'APPLY' : 'AUDIT-ONLY'}`, summary)
  if (APPLY) await apply()
}

main()
  .catch((error: unknown) => {
    console.error(
      '[attachment-url-cutover] FAILED:',
      error instanceof Error ? error.message : error,
    )
    process.exitCode = 1
  })
  .finally(() => sql.end({ timeout: 5 }))
