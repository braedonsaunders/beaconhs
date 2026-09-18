// One-off: bring every document master onto the house paper size.
//
// The legacy import brought in A4 masters — 382 of 383 documents — while the
// blank master new documents start from is Letter. A book composed from mixed
// paper has to scale the odd sizes down to fit, which shrinks their type and
// widens their margins against everything else, so the whole manual reads as a
// pile of documents rather than one.
//
// Converting the MASTER, not just the render, is the durable fix: the author
// sees Letter in the editor, and the next save cannot reintroduce A4.
//
//   pnpm --filter @beaconhs/worker exec tsx src/scripts/convert-documents-to-letter.ts [--apply] [--limit N]
//
// Without --apply it reports what it would do and changes nothing. It is
// idempotent — anything already on the target size is skipped — so it is meant
// to be run repeatedly in batches until it reports nothing left.
//
// BOUNDED ON PURPOSE. Each document costs two LibreOffice invocations, and a
// few hundred back to back will exhaust a workstation's memory. --limit caps
// how many are converted per run (default 40); raise it only on a machine with
// room to spare.
//
// NOTE: this rewrites published version snapshots in place. That is deliberate
// for a pre-launch library of imported content — the documents are being
// corrected, not revised — but it does mean an approved snapshot's bytes change.

import { and, eq, isNotNull } from 'drizzle-orm'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import { attachments, documents, documentVersions } from '@beaconhs/db/schema'
import { getObject, newAttachmentKey, putObject } from '@beaconhs/storage'
import { audit } from '@beaconhs/audit'
import { sofficeConvert } from '@beaconhs/office'
import { isNormalizedDocx, normalizeDocxTypography } from '@beaconhs/office/docx-page-size'
import { measureRenderedType } from '../lib/pdf-body-type'

const TARGET = 'letter'
/**
 * The body size every document should LOOK like, as a measured glyph height in
 * points — not a declared point size, which settles nothing when one master is
 * Liberation Serif and the next is a sans face.
 *
 * Reached approximately, not exactly: rendered glyph heights quantise, so a
 * document lands on 12 or 13 and stays there. Whether it is done is decided by
 * `isNormalizedDocx`, which looks at structure — an earlier version of this
 * script asked "does it render at the target yet?" and rewrote the same 83
 * masters 291 times, oscillating 13 -> 12 -> 13 -> 12.
 */
const TARGET_BODY_PT = 12.5
const MAX_TEXT_CHARS = 1_500_000
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

type Candidate = {
  versionId: string
  documentId: string
  tenantId: string
  version: number
  docKey: string
  docTitle: string
  docxKey: string
}

/** Render a master and report the paper and body size it actually produces. */
async function measureRender(docx: Buffer): Promise<{ letter: boolean; bodyPt: number | null }> {
  const pdf = await sofficeConvert(docx, 'document.docx', 'pdf')
  const { pageWidthPt, bodyTypePt } = await measureRenderedType(pdf)
  return {
    letter: pageWidthPt !== null && Math.abs(pageWidthPt - 612) < 2,
    bodyPt: bodyTypePt,
  }
}

/** Conversions per run, unless --limit says otherwise. */
const DEFAULT_LIMIT = 40

/**
 * Split the work so several copies of this script can run at once.
 *
 * Each conversion is two LibreOffice renders, and LibreOffice is single
 * threaded — one process leaves most of a workstation idle. `--shard 2/6`
 * takes every sixth version starting at the second, so six shards cover the
 * library without coordinating.
 */
function parseShard(argv: readonly string[]): { index: number; total: number } {
  const flag = argv.indexOf('--shard')
  if (flag === -1) return { index: 0, total: 1 }
  const parts = (argv[flag + 1] ?? '').split('/').map(Number)
  const index = parts[0] ?? NaN
  const total = parts[1] ?? NaN
  if (
    !Number.isInteger(index) ||
    !Number.isInteger(total) ||
    total < 1 ||
    index < 1 ||
    index > total
  ) {
    throw new Error('--shard needs the form i/n, 1-based, for example 2/6')
  }
  return { index: index - 1, total }
}

function parseLimit(argv: readonly string[]): number {
  const flag = argv.indexOf('--limit')
  if (flag === -1) return DEFAULT_LIMIT
  const value = Number(argv[flag + 1])
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('--limit needs a positive whole number')
  }
  return value
}

async function main() {
  const apply = process.argv.includes('--apply')
  const limit = parseLimit(process.argv)
  const shard = parseShard(process.argv)

  const candidates = await withSuperAdmin(db, (tx) =>
    tx
      .select({
        versionId: documentVersions.id,
        documentId: documentVersions.documentId,
        tenantId: documentVersions.tenantId,
        version: documentVersions.version,
        docKey: documents.key,
        docTitle: documents.title,
        docxKey: attachments.r2Key,
      })
      .from(documentVersions)
      .innerJoin(attachments, eq(attachments.id, documentVersions.docxAttachmentId))
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .where(isNotNull(documentVersions.docxAttachmentId)),
  )

  const mine = (candidates as Candidate[]).filter(
    (_, position) => position % shard.total === shard.index,
  )
  const label = shard.total > 1 ? ` [shard ${shard.index + 1}/${shard.total}]` : ''
  console.log(
    `${mine.length} of ${candidates.length} version(s) in scope${label}; at most ${limit}`,
  )

  let converted = 0
  let alreadyCorrect = 0
  let failed = 0
  let remaining = 0

  for (const row of mine) {
    if (converted >= limit) {
      remaining++
      continue
    }
    const label = `${row.docKey || row.docTitle} v${row.version}`
    try {
      const docx = await getObject({ key: row.docxKey })
      if (await isNormalizedDocx(docx, TARGET)) {
        alreadyCorrect++
        continue
      }

      if (!apply) {
        console.log(`  would normalise ${label}`)
        converted++
        continue
      }

      // Scale by what the render MEASURED, so documents in different typefaces
      // end up looking the same size rather than merely declaring the same one.
      const before = await measureRender(docx)
      const sizeFactor = before.bodyPt ? TARGET_BODY_PT / before.bodyPt : undefined
      const letter = await normalizeDocxTypography(docx, TARGET, { sizeFactor })
      const pdf = await sofficeConvert(letter, 'document.docx', 'pdf')
      const text = (await sofficeConvert(letter, 'document.docx', 'txt:Text'))
        .toString('utf8')
        .slice(0, MAX_TEXT_CHARS)

      const base =
        (row.docKey || row.docTitle || 'document')
          .replace(/[^\w.\- ]+/g, '')
          .trim()
          .slice(0, 180) || 'document'
      const docxName = `${base}-v${row.version}.docx`
      const pdfName = `${base}-v${row.version}.pdf`
      const docxObjectKey = newAttachmentKey({
        tenantId: row.tenantId,
        kind: 'document',
        filename: docxName,
      })
      const pdfObjectKey = newAttachmentKey({
        tenantId: row.tenantId,
        kind: 'document',
        filename: pdfName,
      })
      await putObject({ key: docxObjectKey, body: letter, contentType: DOCX_MIME })
      await putObject({
        key: pdfObjectKey,
        body: pdf,
        contentType: 'application/pdf',
        contentDisposition: 'inline',
      })

      await withTenant(db, row.tenantId, async (tx) => {
        const [docxAtt] = await tx
          .insert(attachments)
          .values({
            tenantId: row.tenantId,
            kind: 'document',
            r2Key: docxObjectKey,
            contentType: DOCX_MIME,
            sizeBytes: letter.length,
            filename: docxName,
          })
          .returning()
        const [pdfAtt] = await tx
          .insert(attachments)
          .values({
            tenantId: row.tenantId,
            kind: 'document',
            r2Key: pdfObjectKey,
            contentType: 'application/pdf',
            sizeBytes: pdf.length,
            filename: pdfName,
          })
          .returning()
        if (!docxAtt || !pdfAtt) throw new Error('Failed to store the converted files')
        await tx
          .update(documentVersions)
          .set({
            docxAttachmentId: docxAtt.id,
            pdfAttachmentId: pdfAtt.id,
            textContent: text,
            renderStatus: 'complete',
            renderError: null,
          })
          .where(
            and(
              eq(documentVersions.id, row.versionId),
              eq(documentVersions.tenantId, row.tenantId),
            ),
          )
        await audit(tx, {
          tenantId: row.tenantId,
          entityType: 'document',
          entityId: row.documentId,
          action: 'update',
          summary: `Normalised version ${row.version} to ${TARGET} paper`,
          metadata: {
            versionId: row.versionId,
            bodyPtBefore: before.bodyPt,
            bodyPtTarget: TARGET_BODY_PT,
          },
        })
      })

      converted++
      if (converted % 25 === 0) console.log(`  converted ${converted}…`)
    } catch (error) {
      failed++
      console.error(`  FAILED ${label}: ${(error as Error).message}`)
    }
  }

  console.log(
    `\n${apply ? 'converted' : 'would convert'} ${converted}; already ${TARGET}: ${alreadyCorrect}; failed: ${failed}`,
  )
  if (remaining > 0) {
    console.log(`${remaining} still to do — run again to continue.`)
  }
  if (!apply) console.log('Re-run with --apply to write the changes.')
  process.exit(failed > 0 ? 1 : 0)
}

void main()
