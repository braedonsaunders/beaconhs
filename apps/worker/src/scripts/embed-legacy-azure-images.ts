// One-off: embed the old Beacon's Azure-linked images into document masters.
//
// The legacy import produced DOCX masters whose images are LINKS to
// https://beaconhs.blob.core.windows.net/... instead of embedded media.
// LibreOffice renders nothing for a linked image, so every published PDF
// silently lost its pictures — and the links die with the old Azure account.
//
//   pnpm --filter @beaconhs/worker exec tsx src/scripts/embed-legacy-azure-images.ts [--apply] [--limit N]
//
// Without --apply it downloads nothing and changes nothing: it scans and
// reports what it would embed. With --apply, per affected file it downloads
// each linked image (that one Azure host only, size-capped), embeds it as a
// media part, and writes the file back IN PLACE (same storage key, bumped
// attachment stamp so an open Collabora session cannot clobber it):
//   • the working DOCX master (documents.source_attachment_id), and
//   • the CURRENT published version's DOCX snapshot — patched in place and
//     re-rendered, deliberately NOT published as a new version, so nobody is
//     asked to re-acknowledge a document whose words did not change.
// Training PPTX decks (lesson + library masters) get the same treatment.
//
// Idempotent: embedded files have no external image relationships left, so
// re-runs skip them. A failed download leaves that file untouched. Files an
// earlier pass embedded but left with pictures still LINKING the media (which
// renders nothing) are repaired in place on any run.

import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import {
  attachments,
  documents,
  documentVersions,
  trainingContentItems,
  trainingLessons,
} from '@beaconhs/db/schema'
import { getObject, putObject } from '@beaconhs/storage'
import { audit } from '@beaconhs/audit'
import {
  embedExternalImages,
  findExternalImages,
  repairLinkedEmbeddedImages,
} from '@beaconhs/office/external-images'
import { fetchAllowListedBytes } from '@beaconhs/sync/egress'
import { renderDocumentVersion } from '../workers/document-render'

const AZURE_HOST = 'beaconhs.blob.core.windows.net'
const MAX_IMAGE_BYTES = 16 * 1024 * 1024
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

type Target = {
  tenantId: string
  attachmentId: string
  r2Key: string
  contentType: string
  label: string
  auditEntityType: string
  auditEntityId: string
  /** Set when this file is the current published version's DOCX. */
  render?: { documentId: string; versionId: string }
}

function isOfficeFile(contentType: string, filename: string, kind: 'docx' | 'pptx'): boolean {
  const mime = kind === 'docx' ? DOCX_MIME : PPTX_MIME
  return contentType === mime || filename.toLowerCase().endsWith(`.${kind}`)
}

async function documentTargets(): Promise<Target[]> {
  const rows = await withSuperAdmin(db, (tx) =>
    tx
      .select({
        documentId: documents.id,
        tenantId: documents.tenantId,
        title: documents.title,
        key: documents.key,
        sourceAttachmentId: documents.sourceAttachmentId,
      })
      .from(documents)
      .where(isNull(documents.deletedAt)),
  )
  const targets: Target[] = []
  for (const doc of rows) {
    const label = doc.key || doc.title
    if (doc.sourceAttachmentId) {
      const att = await attachmentOf(doc.sourceAttachmentId)
      if (att && isOfficeFile(att.contentType, att.filename, 'docx')) {
        targets.push({
          tenantId: doc.tenantId,
          attachmentId: att.id,
          r2Key: att.r2Key,
          contentType: DOCX_MIME,
          label: `${label} (working master)`,
          auditEntityType: 'document',
          auditEntityId: doc.documentId,
        })
      }
    }
    const [version] = await withSuperAdmin(db, (tx) =>
      tx
        .select({
          id: documentVersions.id,
          version: documentVersions.version,
          docxAttachmentId: documentVersions.docxAttachmentId,
        })
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.documentId, doc.documentId),
            isNotNull(documentVersions.publishedAt),
          ),
        )
        .orderBy(desc(documentVersions.version))
        .limit(1),
    )
    if (version?.docxAttachmentId && version.docxAttachmentId !== doc.sourceAttachmentId) {
      const att = await attachmentOf(version.docxAttachmentId)
      if (att && isOfficeFile(att.contentType, att.filename, 'docx')) {
        targets.push({
          tenantId: doc.tenantId,
          attachmentId: att.id,
          r2Key: att.r2Key,
          contentType: DOCX_MIME,
          label: `${label} v${version.version} (published)`,
          auditEntityType: 'document',
          auditEntityId: doc.documentId,
          render: { documentId: doc.documentId, versionId: version.id },
        })
      }
    }
  }
  return targets
}

async function attachmentOf(id: string) {
  const [att] = await withSuperAdmin(db, (tx) =>
    tx
      .select({
        id: attachments.id,
        r2Key: attachments.r2Key,
        contentType: attachments.contentType,
        filename: attachments.filename,
      })
      .from(attachments)
      .where(eq(attachments.id, id))
      .limit(1),
  )
  return att ?? null
}

async function deckTargets(): Promise<Target[]> {
  const targets: Target[] = []
  const lessons = await withSuperAdmin(db, (tx) =>
    tx
      .select({
        id: trainingLessons.id,
        tenantId: trainingLessons.tenantId,
        title: trainingLessons.title,
        sourceAttachmentId: trainingLessons.sourceAttachmentId,
      })
      .from(trainingLessons)
      .where(isNotNull(trainingLessons.sourceAttachmentId)),
  )
  for (const lesson of lessons) {
    const att = lesson.sourceAttachmentId ? await attachmentOf(lesson.sourceAttachmentId) : null
    if (att && isOfficeFile(att.contentType, att.filename, 'pptx')) {
      targets.push({
        tenantId: lesson.tenantId,
        attachmentId: att.id,
        r2Key: att.r2Key,
        contentType: PPTX_MIME,
        label: `lesson deck "${lesson.title}"`,
        auditEntityType: 'training_lesson',
        auditEntityId: lesson.id,
      })
    }
  }
  const items = await withSuperAdmin(db, (tx) =>
    tx
      .select({
        id: trainingContentItems.id,
        tenantId: trainingContentItems.tenantId,
        title: trainingContentItems.title,
        sourceAttachmentId: trainingContentItems.sourceAttachmentId,
      })
      .from(trainingContentItems)
      .where(isNotNull(trainingContentItems.sourceAttachmentId)),
  )
  for (const item of items) {
    const att = item.sourceAttachmentId ? await attachmentOf(item.sourceAttachmentId) : null
    if (att && isOfficeFile(att.contentType, att.filename, 'pptx')) {
      targets.push({
        tenantId: item.tenantId,
        attachmentId: att.id,
        r2Key: att.r2Key,
        contentType: PPTX_MIME,
        label: `library deck "${item.title}"`,
        auditEntityType: 'training_content_item',
        auditEntityId: item.id,
      })
    }
  }
  return targets
}

// In place: same key, and the attachment stamp bump is the WOPI version
// token — an editor holding the old file cannot overwrite this. A published
// version's snapshot is re-rendered so readers see the change.
async function writeInPlace(
  target: Target,
  bytes: Buffer,
  summary: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await putObject({ key: target.r2Key, body: bytes, contentType: target.contentType })
  await withTenant(db, target.tenantId, async (tx) => {
    await tx
      .update(attachments)
      .set({ sizeBytes: bytes.length, updatedAt: new Date() })
      .where(eq(attachments.id, target.attachmentId))
    if (target.render) {
      await tx
        .update(documentVersions)
        .set({ renderStatus: 'pending', renderError: null })
        .where(eq(documentVersions.id, target.render.versionId))
    }
    await audit(tx, {
      tenantId: target.tenantId,
      entityType: target.auditEntityType,
      entityId: target.auditEntityId,
      action: 'update',
      summary,
      metadata: {
        ...metadata,
        ...(target.render ? { versionId: target.render.versionId } : {}),
      },
    })
  })
  if (target.render) {
    await renderDocumentVersion({
      tenantId: target.tenantId,
      documentId: target.render.documentId,
      versionId: target.render.versionId,
    })
  }
}

function parseLimit(argv: readonly string[]): number {
  const flag = argv.indexOf('--limit')
  if (flag === -1) return Number.POSITIVE_INFINITY
  const value = Number(argv[flag + 1])
  if (!Number.isInteger(value) || value <= 0)
    throw new Error('--limit needs a positive whole number')
  return value
}

async function main() {
  const apply = process.argv.includes('--apply')
  const limit = parseLimit(process.argv)
  const targets = [...(await documentTargets()), ...(await deckTargets())]
  console.log(`${targets.length} office file(s) in scope`)

  let affected = 0
  let embeddedImages = 0
  let repairedPictures = 0
  let failed = 0
  let remaining = 0

  for (const target of targets) {
    try {
      const bytes = await getObject({ key: target.r2Key })
      const refs = await findExternalImages(bytes)
      const azureRefs = refs.filter((r) => {
        try {
          return new URL(r.url).hostname.toLowerCase() === AZURE_HOST
        } catch {
          return false
        }
      })
      if (refs.length > azureRefs.length) {
        console.log(
          `  note: ${target.label} also links ${refs.length - azureRefs.length} image(s) from other hosts — left alone`,
        )
      }
      if (azureRefs.length === 0) {
        // An earlier pass embedded the media but left the pictures LINKING it,
        // which renders nothing. Convert those links to embeds in place.
        const repair = await repairLinkedEmbeddedImages(bytes)
        if (repair.repaired === 0) continue
        repairedPictures += repair.repaired
        if (!apply) {
          console.log(`  would repair ${repair.repaired} picture(s) in ${target.label}`)
          continue
        }
        await writeInPlace(
          target,
          repair.bytes,
          `Repaired ${repair.repaired} embedded legacy picture(s) in ${target.label}`,
          {
            attachmentId: target.attachmentId,
            repairedPictures: repair.repaired,
          },
        )
        console.log(`  repaired ${repair.repaired} picture(s) in ${target.label}`)
        continue
      }
      if (affected >= limit) {
        remaining++
        continue
      }
      affected++
      if (!apply) {
        console.log(`  would embed ${azureRefs.length} image(s) in ${target.label}`)
        embeddedImages += azureRefs.length
        continue
      }
      const result = await embedExternalImages(bytes, (url) =>
        fetchAllowListedBytes(url, { allowedHosts: [AZURE_HOST], maxBytes: MAX_IMAGE_BYTES }),
      )
      for (const f of result.failed) {
        failed++
        console.error(`  FAILED download ${f.url} (${target.label}): ${f.error}`)
      }
      if (result.embedded.length === 0) continue
      embeddedImages += result.embedded.length
      await writeInPlace(
        target,
        result.bytes,
        `Embedded ${result.embedded.length} legacy linked image(s) into ${target.label}`,
        { attachmentId: target.attachmentId, images: result.embedded },
      )
      console.log(`  embedded ${result.embedded.length} image(s) in ${target.label}`)
    } catch (error) {
      failed++
      console.error(`  FAILED ${target.label}: ${(error as Error).message}`)
    }
  }

  console.log(
    `\n${apply ? 'embedded into' : 'would embed into'} ${affected} file(s), ${embeddedImages} image(s); failures: ${failed}`,
  )
  if (repairedPictures > 0) {
    console.log(`${apply ? 'repaired' : 'would repair'} ${repairedPictures} linked picture(s)`)
  }
  if (remaining > 0) console.log(`${remaining} affected file(s) left — run again to continue.`)
  if (!apply) console.log('Re-run with --apply to write the changes.')
  process.exit(failed > 0 ? 1 : 0)
}

void main()
