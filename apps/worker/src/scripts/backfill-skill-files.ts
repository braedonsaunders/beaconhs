// One-off backfill: legacy skill (and training-record) "files" were stored as
// raw URLs stuffed into the `notes` field, e.g.
//   "Complete · https://beaconhs.blob.core.windows.net/.../Screen Shot ….png"
// This downloads each referenced file from the legacy Azure blob store, re-hosts
// it in our object storage, and attaches it properly:
//   • skills  → training_skill_assignment_files row (+ attachments row)
//   • records → attachments row keyed under training/records/<id>/… so the
//               records detail "Attachments" tab (prefix-listed) picks it up
// The original URL is preserved on attachments.caption (provenance), so it's
// never lost. By default the now-redundant URL is stripped from the note
// (pass --keep-notes to leave notes untouched). Idempotent: re-runs skip URLs
// already imported (matched by caption) and won't re-find stripped notes.
//
// Run:
//   cd apps/worker
//   npx tsx --env-file=../../.env src/scripts/backfill-skill-files.ts --dry-run
//   npx tsx --env-file=../../.env src/scripts/backfill-skill-files.ts            # live
// Flags: --dry-run · --keep-notes · --tenant <slug> · --limit <n> ·
//        --skip-records · --skip-skills

import { sql } from 'drizzle-orm'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import {
  attachments,
  tenants,
  trainingRecords,
  trainingSkillAssignmentFiles,
  trainingSkillAssignments,
} from '@beaconhs/db/schema'
import { ensureBucket, newAttachmentKey, newTenantObjectKey, putObject } from '@beaconhs/storage'

// ---------- args ----------
const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const KEEP_NOTES = args.includes('--keep-notes')
const SKIP_RECORDS = args.includes('--skip-records')
const SKIP_SKILLS = args.includes('--skip-skills')
const TENANT_SLUG = argVal('--tenant')
const LIMIT = Number(argVal('--limit') ?? '0') || 0
const CONCURRENCY = 5

function argVal(flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

// ---------- helpers ----------
type Kind = 'image' | 'document' | 'video' | 'audio' | 'other'

function kindFromType(mime: string): Kind {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (
    mime === 'application/pdf' ||
    mime.includes('msword') ||
    mime.includes('officedocument') ||
    mime.includes('document') ||
    mime.includes('sheet') ||
    mime.includes('excel')
  )
    return 'document'
  return 'other'
}

const EXT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  bmp: 'image/bmp',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  csv: 'text/csv',
}

function typeFor(filename: string, headerType: string | null): string {
  const clean = (headerType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (clean && clean !== 'application/octet-stream' && clean !== 'binary/octet-stream') return clean
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TYPES[ext] ?? 'application/octet-stream'
}

/** Extract the URL embedded in a notes/details field (runs to end-of-string). */
function extractUrl(text: string | null): string | null {
  if (!text) return null
  const idx = text.search(/https?:\/\//)
  if (idx < 0) return null
  return text.slice(idx).trim()
}

function encodeUrl(raw: string): string {
  // Legacy URLs contain raw spaces (and sometimes #). encodeURI keeps parens
  // (Azure serves them literally) but fixes spaces; patch # which it leaves.
  return encodeURI(raw).replace(/#/g, '%23')
}

function filenameFromUrl(raw: string): string {
  const path = raw.split('?')[0] ?? raw
  const seg = path.split('/').pop() || 'file'
  try {
    return seg.length ? decodeURIComponent(seg) : 'file'
  } catch {
    return seg || 'file'
  }
}

/** Remove the URL + legacy "Complete ·" boilerplate; null when nothing real left. */
function cleanField(text: string, url: string): string | null {
  let s = text.split(url).join(' ')
  s = s
    .replace(/[ \t]*[·•|][ \t]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const core = s.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (core === '' || core === 'complete') return null
  return s
}

async function mapPool<T, R>(
  items: T[],
  n: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await fn(items[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()))
  return out
}

type FetchedFile = { buffer: Buffer; contentType: string; filename: string }

async function download(rawUrl: string): Promise<FetchedFile | { error: string }> {
  try {
    const res = await fetch(encodeUrl(rawUrl))
    if (!res.ok) return { error: `HTTP ${res.status}` }
    const ab = await res.arrayBuffer()
    const buffer = Buffer.from(ab)
    if (buffer.length === 0) return { error: 'empty body' }
    const filename = filenameFromUrl(rawUrl)
    return { buffer, contentType: typeFor(filename, res.headers.get('content-type')), filename }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// ---------- main ----------
const stats = {
  skillsScanned: 0,
  skillsImported: 0,
  skillsSkipped: 0,
  skillsFailed: 0,
  recordsScanned: 0,
  recordsImported: 0,
  recordsSkipped: 0,
  recordsFailed: 0,
  notesCleaned: 0,
}

async function main() {
  console.log(
    `▶ Backfill skill/record files  ${DRY ? '[DRY RUN]' : '[LIVE]'}` +
      `${KEEP_NOTES ? ' [keep-notes]' : ''}${TENANT_SLUG ? ` tenant=${TENANT_SLUG}` : ''}` +
      `${LIMIT ? ` limit=${LIMIT}` : ''}`,
  )
  if (!DRY) await ensureBucket()

  const tenantRows = await withSuperAdmin(db, (tx) =>
    tx.select({ id: tenants.id, slug: tenants.slug, name: tenants.name }).from(tenants),
  )
  const targets = TENANT_SLUG ? tenantRows.filter((t) => t.slug === TENANT_SLUG) : tenantRows
  if (targets.length === 0) {
    console.log(`No tenant matched "${TENANT_SLUG}".`)
    return
  }

  for (const tenant of targets) {
    console.log(`\n── ${tenant.slug} (${tenant.name}) ──`)
    if (!SKIP_SKILLS) await processSkills(tenant.id)
    if (!SKIP_RECORDS) await processRecords(tenant.id)
  }

  console.log('\n════ summary ════')
  console.table(stats)
  if (DRY) console.log('Dry run — no changes written.')
}

async function processSkills(tenantId: string) {
  // Assignments whose notes still hold a URL.
  let rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ id: trainingSkillAssignments.id, notes: trainingSkillAssignments.notes })
      .from(trainingSkillAssignments)
      .where(sql`${trainingSkillAssignments.notes} ~ 'https?://'`),
  )
  if (LIMIT) rows = rows.slice(0, LIMIT)
  stats.skillsScanned += rows.length
  if (rows.length === 0) {
    console.log('  skills: none with file URLs')
    return
  }

  // Already-imported URLs (provenance on attachments.caption).
  const existing = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        assignmentId: trainingSkillAssignmentFiles.skillAssignmentId,
        caption: attachments.caption,
      })
      .from(trainingSkillAssignmentFiles)
      .innerJoin(
        attachments,
        sql`${attachments.id} = ${trainingSkillAssignmentFiles.attachmentId}`,
      ),
  )
  const done = new Set(
    existing.filter((e) => e.caption).map((e) => `${e.assignmentId}::${e.caption}`),
  )

  console.log(`  skills: ${rows.length} with URLs`)
  await mapPool(rows, CONCURRENCY, async (row) => {
    const url = extractUrl(row.notes)
    if (!url) return
    if (done.has(`${row.id}::${url}`)) {
      stats.skillsSkipped++
      return
    }
    const got = await download(url)
    if ('error' in got) {
      stats.skillsFailed++
      console.log(`    ✗ ${row.id}  ${got.error}  ${url.slice(0, 90)}`)
      return
    }
    if (DRY) {
      stats.skillsImported++
      console.log(
        `    · would import ${got.filename} (${(got.buffer.length / 1024).toFixed(0)}KB) → ${row.id}`,
      )
      return
    }
    const kind = kindFromType(got.contentType)
    const key = newAttachmentKey({ tenantId, kind, filename: got.filename })
    await putObject({
      key,
      body: got.buffer,
      contentType: got.contentType,
      contentDisposition: kind === 'image' ? 'inline' : 'attachment',
    })
    await withTenant(db, tenantId, async (tx) => {
      const [att] = await tx
        .insert(attachments)
        .values({
          tenantId,
          kind,
          r2Key: key,
          contentType: got.contentType,
          sizeBytes: got.buffer.length,
          filename: got.filename,
          caption: url,
        })
        .returning({ id: attachments.id })
      await tx.insert(trainingSkillAssignmentFiles).values({
        tenantId,
        skillAssignmentId: row.id,
        attachmentId: att!.id,
        label: got.filename,
        kind: 'certificate',
      })
      if (!KEEP_NOTES) {
        const cleaned = cleanField(row.notes ?? '', url)
        if (cleaned !== (row.notes ?? '')) {
          await tx
            .update(trainingSkillAssignments)
            .set({ notes: cleaned })
            .where(sql`${trainingSkillAssignments.id} = ${row.id}`)
          stats.notesCleaned++
        }
      }
    })
    stats.skillsImported++
    console.log(`    ✓ ${got.filename} → ${row.id}`)
  })
}

async function processRecords(tenantId: string) {
  let rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        id: trainingRecords.id,
        notes: trainingRecords.notes,
        details: trainingRecords.details,
      })
      .from(trainingRecords)
      .where(
        sql`${trainingRecords.notes} ~ 'https?://' or ${trainingRecords.details} ~ 'https?://'`,
      ),
  )
  if (LIMIT) rows = rows.slice(0, LIMIT)
  stats.recordsScanned += rows.length
  if (rows.length === 0) {
    console.log('  records: none with file URLs')
    return
  }

  // Already-imported (prefix-keyed) record attachments, by caption.
  const existing = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ caption: attachments.caption })
      .from(attachments)
      .where(
        sql`${attachments.r2Key} like ${`t/${tenantId}/document/training-records/%`} and ${attachments.caption} is not null`,
      ),
  )
  const done = new Set(existing.map((e) => e.caption))

  console.log(`  records: ${rows.length} with URLs`)
  await mapPool(rows, CONCURRENCY, async (row) => {
    const fields: { field: 'notes' | 'details'; url: string }[] = []
    const nUrl = extractUrl(row.notes)
    const dUrl = extractUrl(row.details)
    if (nUrl) fields.push({ field: 'notes', url: nUrl })
    if (dUrl && dUrl !== nUrl) fields.push({ field: 'details', url: dUrl })

    for (const f of fields) {
      if (done.has(f.url)) {
        stats.recordsSkipped++
        continue
      }
      const got = await download(f.url)
      if ('error' in got) {
        stats.recordsFailed++
        console.log(`    ✗ record ${row.id}  ${got.error}  ${f.url.slice(0, 90)}`)
        continue
      }
      if (DRY) {
        stats.recordsImported++
        console.log(`    · would import ${got.filename} → record ${row.id}`)
        continue
      }
      // Records list attachments by r2Key prefix + kind='document'.
      const key = newTenantObjectKey({
        tenantId,
        scope: `document/training-records/${row.id}`,
        filename: got.filename,
      })
      await putObject({
        key,
        body: got.buffer,
        contentType: got.contentType,
        contentDisposition: 'attachment',
      })
      await withTenant(db, tenantId, async (tx) => {
        await tx.insert(attachments).values({
          tenantId,
          kind: 'document',
          r2Key: key,
          contentType: got.contentType,
          sizeBytes: got.buffer.length,
          filename: got.filename,
          caption: f.url,
        })
        if (!KEEP_NOTES) {
          const current = f.field === 'notes' ? (row.notes ?? '') : (row.details ?? '')
          const cleaned = cleanField(current, f.url)
          if (cleaned !== current) {
            await tx
              .update(trainingRecords)
              .set(f.field === 'notes' ? { notes: cleaned } : { details: cleaned })
              .where(sql`${trainingRecords.id} = ${row.id}`)
            stats.notesCleaned++
          }
        }
      })
      stats.recordsImported++
      console.log(`    ✓ ${got.filename} → record ${row.id}`)
    }
  })
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
